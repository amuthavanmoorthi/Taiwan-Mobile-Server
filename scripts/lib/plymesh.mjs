/**
 * Reader for the triangle-mesh PLY that splat_reconstruct.py writes.
 *
 * Deliberately narrow: Open3D's writer is the only producer, so this handles
 * the layout it emits rather than the whole PLY zoo. Anything else is
 * rejected loudly instead of being half-parsed into a broken mesh.
 */

const SIZES = {
  char: 1, uchar: 1, int8: 1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4,
  double: 8, float64: 8,
};

const readers = {
  1: (buf, off, signed) => (signed ? buf.readInt8(off) : buf.readUInt8(off)),
  2: (buf, off, signed) => (signed ? buf.readInt16LE(off) : buf.readUInt16LE(off)),
  4: (buf, off, signed, float) =>
    float ? buf.readFloatLE(off) : signed ? buf.readInt32LE(off) : buf.readUInt32LE(off),
  8: (buf, off) => buf.readDoubleLE(off),
};

const isFloat = (t) => t.startsWith("float") || t === "double";
const isSigned = (t) => !t.startsWith("u");

export function readPlyMesh(buf) {
  const headerEnd = buf.indexOf("end_header\n");
  if (headerEnd < 0) throw new Error("Not a PLY file: no end_header.");
  const header = buf.subarray(0, headerEnd).toString("ascii");

  if (!/format\s+binary_little_endian/.test(header)) {
    throw new Error("Only binary_little_endian PLY meshes are supported.");
  }

  // Parse the element/property tables in order — offsets depend on it.
  const elements = [];
  let current = null;
  for (const line of header.split("\n")) {
    const el = line.match(/^element\s+(\w+)\s+(\d+)/);
    if (el) {
      current = { name: el[1], count: Number(el[2]), props: [] };
      elements.push(current);
      continue;
    }
    const list = line.match(/^property\s+list\s+(\w+)\s+(\w+)\s+(\w+)/);
    if (list && current) {
      current.props.push({ list: true, countType: list[1], type: list[2], name: list[3] });
      continue;
    }
    const prop = line.match(/^property\s+(\w+)\s+(\w+)/);
    if (prop && current) current.props.push({ list: false, type: prop[1], name: prop[2] });
  }

  const vertexEl = elements.find((e) => e.name === "vertex");
  const faceEl = elements.find((e) => e.name === "face");
  if (!vertexEl || !faceEl) throw new Error("PLY is missing a vertex or face element.");

  let off = headerEnd + "end_header\n".length;

  // --- vertices ---
  const names = vertexEl.props.map((p) => p.name);
  for (const need of ["x", "y", "z"]) {
    if (!names.includes(need)) throw new Error(`PLY vertices have no '${need}'.`);
  }
  const hasNormals = ["nx", "ny", "nz"].every((n) => names.includes(n));
  const hasColors = ["red", "green", "blue"].every((n) => names.includes(n));

  const n = vertexEl.count;
  const positions = new Float32Array(n * 3);
  const normals = hasNormals ? new Float32Array(n * 3) : null;
  const colors = hasColors ? new Float32Array(n * 3) : null;

  const stride = vertexEl.props.reduce((sum, p) => {
    const size = SIZES[p.type];
    if (!size) throw new Error(`Unsupported PLY property type '${p.type}'.`);
    return sum + size;
  }, 0);

  if (off + n * stride > buf.length) throw new Error("PLY is truncated in the vertex block.");

  for (let i = 0; i < n; i++) {
    let p = off + i * stride;
    for (const prop of vertexEl.props) {
      const size = SIZES[prop.type];
      const value = readers[size](buf, p, isSigned(prop.type), isFloat(prop.type));
      switch (prop.name) {
        case "x": positions[i * 3] = value; break;
        case "y": positions[i * 3 + 1] = value; break;
        case "z": positions[i * 3 + 2] = value; break;
        case "nx": if (normals) normals[i * 3] = value; break;
        case "ny": if (normals) normals[i * 3 + 1] = value; break;
        case "nz": if (normals) normals[i * 3 + 2] = value; break;
        // Open3D writes colour as uchar 0-255; glTF COLOR_0 wants 0-1.
        case "red": if (colors) colors[i * 3] = isFloat(prop.type) ? value : value / 255; break;
        case "green": if (colors) colors[i * 3 + 1] = isFloat(prop.type) ? value : value / 255; break;
        case "blue": if (colors) colors[i * 3 + 2] = isFloat(prop.type) ? value : value / 255; break;
      }
      p += size;
    }
  }
  off += n * stride;

  // --- faces ---
  const indices = [];
  const faceProp = faceEl.props.find((p) => p.list);
  if (!faceProp) throw new Error("PLY face element has no vertex index list.");
  const countSize = SIZES[faceProp.countType];
  const idxSize = SIZES[faceProp.type];

  for (let f = 0; f < faceEl.count; f++) {
    if (off + countSize > buf.length) throw new Error("PLY is truncated in the face block.");
    const count = readers[countSize](buf, off, isSigned(faceProp.countType), false);
    off += countSize;
    if (off + count * idxSize > buf.length) throw new Error("PLY is truncated in the face block.");

    const face = [];
    for (let k = 0; k < count; k++) {
      face.push(readers[idxSize](buf, off, isSigned(faceProp.type), isFloat(faceProp.type)));
      off += idxSize;
    }
    // Fan-triangulate anything with more than three corners.
    for (let k = 2; k < face.length; k++) indices.push(face[0], face[k - 1], face[k]);
  }

  if (indices.length === 0) throw new Error("PLY mesh has no triangles.");

  return {
    positions,
    normals,
    colors,
    indices: new Uint32Array(indices),
    vertexCount: n,
  };
}
