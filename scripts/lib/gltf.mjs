/**
 * Textured GLB and USDZ writers.
 *
 * One mesh, one material, one embedded PNG. Both formats carry the same
 * geometry and the same base-colour texture so Android Scene Viewer and iOS
 * AR Quick Look show the same thing.
 */

import { crc32 } from "node:zlib";

const pad4 = (n) => (n + 3) & ~3;

export function writeGlb({ positions, normals, uvs, indices, texture, mimeType = "image/jpeg" }) {
  const pos = new Float32Array(positions);
  const nor = new Float32Array(normals);
  const uv = new Float32Array(uvs);
  const idx = new Uint32Array(indices);

  const parts = [];
  const views = [];
  let offset = 0;

  const push = (typed, target) => {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const padded = Buffer.alloc(pad4(buf.length));
    buf.copy(padded);
    parts.push(padded);
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    offset += padded.length;
    return views.length - 1;
  };

  const posView = push(pos, 34962);
  const norView = push(nor, 34962);
  const uvView = push(uv, 34962);
  const idxView = push(idx, 34963);

  // Image bytes go in the same buffer, no target.
  const imgPadded = Buffer.alloc(pad4(texture.length));
  texture.copy(imgPadded);
  parts.push(imgPadded);
  const imgView = views.length;
  views.push({ buffer: 0, byteOffset: offset, byteLength: texture.length });
  offset += imgPadded.length;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }

  const bin = Buffer.concat(parts);

  const gltf = {
    asset: { version: "2.0", generator: "reuse-furniture photo-to-3d" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.85,
        },
        doubleSided: true,
      },
    ],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ bufferView: imgView, mimeType }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors: [
      { bufferView: posView, componentType: 5126, count: pos.length / 3, type: "VEC3", min, max },
      { bufferView: norView, componentType: 5126, count: nor.length / 3, type: "VEC3" },
      { bufferView: uvView, componentType: 5126, count: uv.length / 2, type: "VEC2" },
      { bufferView: idxView, componentType: 5125, count: idx.length, type: "SCALAR" },
    ],
  };

  const jsonBuf = Buffer.from(JSON.stringify(gltf), "utf8");
  const json = Buffer.concat([jsonBuf, Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);

  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(json.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);

  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);

  return Buffer.concat([header, jh, json, bh, bin]);
}

/* ------------------------------------------------------------------ USDZ */

const ALIGN = 64;

function zipStored(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const headerLen = 30 + nameBuf.length;
    let extraLen = (ALIGN - ((offset + headerLen) % ALIGN)) % ALIGN;
    if (extraLen > 0 && extraLen < 4) extraLen += ALIGN;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(extraLen, 28);

    const extra = Buffer.alloc(extraLen);
    if (extraLen >= 4) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(extraLen - 4, 2);
    }

    chunks.push(local, nameBuf, extra, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += headerLen + extraLen + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

export function writeUsdz({ positions, normals, uvs, indices, texture, ext = "jpg", name }) {
  const tri = (arr, i, k) =>
    `(${arr[i * k].toFixed(6)}, ${arr[i * k + 1].toFixed(6)}${k === 3 ? `, ${arr[i * k + 2].toFixed(6)}` : ""})`;

  const pts = [];
  const nrm = [];
  for (let i = 0; i < positions.length / 3; i++) {
    pts.push(tri(positions, i, 3));
    nrm.push(tri(normals, i, 3));
  }
  const st = [];
  for (let i = 0; i < uvs.length / 2; i++) {
    // USD's texture origin is bottom-left; glTF's is top-left.
    st.push(`(${uvs[i * 2].toFixed(6)}, ${(1 - uvs[i * 2 + 1]).toFixed(6)})`);
  }

  const counts = Array.from({ length: indices.length / 3 }, () => 3);

  const usda = `#usda 1.0
(
\tcustomLayerData = {
\t\tstring creator = "reuse-furniture photo-to-3d"
\t}
\tdefaultPrim = "Root"
\tmetersPerUnit = 1
\tupAxis = "Y"
)

def Xform "Root"
{
\tdef Scope "Scenes" (
\t\tkind = "sceneLibrary"
\t)
\t{
\t\tdef Xform "Scene" (
\t\t\tcustomData = { string sceneName = "${name}" }
\t\t\tsceneName = "${name}"
\t\t)
\t\t{
\t\t\ttoken preliminary:anchoring:type = "plane"
\t\t\ttoken preliminary:planeAnchoring:alignment = "horizontal"

\t\t\tdef Mesh "mesh_0" (
\t\t\t\tprepend apiSchemas = ["MaterialBindingAPI"]
\t\t\t)
\t\t\t{
\t\t\t\tint[] faceVertexCounts = [${counts.join(", ")}]
\t\t\t\tint[] faceVertexIndices = [${Array.from(indices).join(", ")}]
\t\t\t\tnormal3f[] normals = [${nrm.join(", ")}]
\t\t\t\tpoint3f[] points = [${pts.join(", ")}]
\t\t\t\ttexCoord2f[] primvars:st = [${st.join(", ")}] (
\t\t\t\t\tinterpolation = "vertex"
\t\t\t\t)
\t\t\t\tuniform token subdivisionScheme = "none"
\t\t\t\trel material:binding = </Root/Materials/Mat>
\t\t\t}
\t\t}
\t}

\tdef Scope "Materials"
\t{
\t\tdef Material "Mat"
\t\t{
\t\t\ttoken outputs:surface.connect = </Root/Materials/Mat/PreviewSurface.outputs:surface>

\t\t\tdef Shader "PreviewSurface"
\t\t\t{
\t\t\t\tuniform token info:id = "UsdPreviewSurface"
\t\t\t\tcolor3f inputs:diffuseColor.connect = </Root/Materials/Mat/Tex.outputs:rgb>
\t\t\t\tfloat inputs:roughness = 0.85
\t\t\t\tfloat inputs:metallic = 0
\t\t\t\tfloat inputs:opacity = 1
\t\t\t\tint inputs:useSpecularWorkflow = 0
\t\t\t\ttoken outputs:surface
\t\t\t}

\t\t\tdef Shader "uvReader"
\t\t\t{
\t\t\t\tuniform token info:id = "UsdPrimvarReader_float2"
\t\t\t\ttoken inputs:varname = "st"
\t\t\t\tfloat2 inputs:fallback = (0, 0)
\t\t\t\tfloat2 outputs:result
\t\t\t}

\t\t\tdef Shader "Tex"
\t\t\t{
\t\t\t\tuniform token info:id = "UsdUVTexture"
\t\t\t\tasset inputs:file = @textures/${name}.${ext}@
\t\t\t\tfloat2 inputs:st.connect = </Root/Materials/Mat/uvReader.outputs:result>
\t\t\t\ttoken inputs:wrapS = "clamp"
\t\t\t\ttoken inputs:wrapT = "clamp"
\t\t\t\tfloat3 outputs:rgb
\t\t\t}
\t\t}
\t}
}
`;

  return zipStored([
    { name: `${name}.usda`, data: Buffer.from(usda, "utf8") },
    { name: `textures/${name}.${ext}`, data: texture },
  ]);
}

/* ------------------------------------------- vertex-coloured variants */

/**
 * The splat path produces per-vertex colour, not a texture: Poisson gives back
 * an arbitrary surface with no sensible UV layout, and unwrapping it well is a
 * bigger problem than the colour is worth. glTF's COLOR_0 and USD's
 * displayColor both carry it directly, and both Scene Viewer and AR Quick Look
 * honour them.
 *
 * Kept separate from the textured writers above rather than folded into them -
 * the photo pipeline is working and shipping, and a shared code path would put
 * it at risk for no gain.
 */
export function writeGlbVertexColor({ positions, normals, colors, indices }) {
  const pos = new Float32Array(positions);
  const nor = new Float32Array(normals);
  const col = new Float32Array(colors);
  const idx = new Uint32Array(indices);

  const parts = [];
  const views = [];
  let offset = 0;

  const push = (typed, target) => {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const padded = Buffer.alloc(pad4(buf.length));
    buf.copy(padded);
    parts.push(padded);
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    offset += padded.length;
    return views.length - 1;
  };

  const posView = push(pos, 34962);
  const norView = push(nor, 34962);
  const colView = push(col, 34962);
  const idxView = push(idx, 34963);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }

  const bin = Buffer.concat(parts);

  const gltf = {
    asset: { version: "2.0", generator: "reuse-furniture splat-to-3d" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
            indices: 3,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          // White base colour so COLOR_0 multiplies through unchanged.
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 0.9,
        },
        doubleSided: true,
      },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors: [
      { bufferView: posView, componentType: 5126, count: pos.length / 3, type: "VEC3", min, max },
      { bufferView: norView, componentType: 5126, count: nor.length / 3, type: "VEC3" },
      { bufferView: colView, componentType: 5126, count: col.length / 3, type: "VEC3" },
      { bufferView: idxView, componentType: 5125, count: idx.length, type: "SCALAR" },
    ],
  };

  const jsonBuf = Buffer.from(JSON.stringify(gltf), "utf8");
  const json = Buffer.concat([jsonBuf, Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);

  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(json.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);

  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);

  return Buffer.concat([header, jh, json, bh, bin]);
}

export function writeUsdzVertexColor({ positions, normals, colors, indices, name }) {
  const v3 = (arr, i) =>
    `(${arr[i * 3].toFixed(6)}, ${arr[i * 3 + 1].toFixed(6)}, ${arr[i * 3 + 2].toFixed(6)})`;

  const pts = [];
  const nrm = [];
  const col = [];
  for (let i = 0; i < positions.length / 3; i++) {
    pts.push(v3(positions, i));
    nrm.push(v3(normals, i));
    col.push(v3(colors, i));
  }

  const counts = Array.from({ length: indices.length / 3 }, () => 3);

  // No texture entry, so the archive is a single .usda. Still zip-stored and
  // 64-byte aligned, which is what makes it a valid USDZ rather than a zip.
  const usda = `#usda 1.0
(
\tcustomLayerData = {
\t\tstring creator = "reuse-furniture splat-to-3d"
\t}
\tdefaultPrim = "Root"
\tmetersPerUnit = 1
\tupAxis = "Y"
)

def Xform "Root"
{
\tdef Scope "Scenes" (
\t\tkind = "sceneLibrary"
\t)
\t{
\t\tdef Xform "Scene" (
\t\t\tcustomData = { string sceneName = "${name}" }
\t\t\tsceneName = "${name}"
\t\t)
\t\t{
\t\t\ttoken preliminary:anchoring:type = "plane"
\t\t\ttoken preliminary:planeAnchoring:alignment = "horizontal"

\t\t\tdef Mesh "mesh_0" (
\t\t\t\tprepend apiSchemas = ["MaterialBindingAPI"]
\t\t\t)
\t\t\t{
\t\t\t\tint[] faceVertexCounts = [${counts.join(", ")}]
\t\t\t\tint[] faceVertexIndices = [${Array.from(indices).join(", ")}]
\t\t\t\tnormal3f[] normals = [${nrm.join(", ")}]
\t\t\t\tpoint3f[] points = [${pts.join(", ")}]
\t\t\t\tcolor3f[] primvars:displayColor = [${col.join(", ")}] (
\t\t\t\t\tinterpolation = "vertex"
\t\t\t\t)
\t\t\t\tuniform token subdivisionScheme = "none"
\t\t\t\trel material:binding = </Root/Materials/Mat>
\t\t\t}
\t\t}
\t}

\tdef Scope "Materials"
\t{
\t\tdef Material "Mat"
\t\t{
\t\t\ttoken outputs:surface.connect = </Root/Materials/Mat/PreviewSurface.outputs:surface>

\t\t\tdef Shader "PreviewSurface"
\t\t\t{
\t\t\t\tuniform token info:id = "UsdPreviewSurface"
\t\t\t\tcolor3f inputs:diffuseColor.connect = </Root/Materials/Mat/ColorReader.outputs:result>
\t\t\t\tfloat inputs:roughness = 0.9
\t\t\t\tfloat inputs:metallic = 0
\t\t\t\tfloat inputs:opacity = 1
\t\t\t\tint inputs:useSpecularWorkflow = 0
\t\t\t\ttoken outputs:surface
\t\t\t}

\t\t\tdef Shader "ColorReader"
\t\t\t{
\t\t\t\tuniform token info:id = "UsdPrimvarReader_float3"
\t\t\t\ttoken inputs:varname = "displayColor"
\t\t\t\tfloat3 inputs:fallback = (0.6, 0.6, 0.6)
\t\t\t\tfloat3 outputs:result
\t\t\t}
\t\t}
\t}
}
`;

  return zipStored([{ name: `${name}.usda`, data: Buffer.from(usda, "utf8") }]);
}
