/**
 * Silhouette contour tracing and triangulation.
 *
 * Moore-neighbour boundary tracing gives an ordered outline; Douglas-Peucker
 * simplifies it; ear clipping turns it into triangles for the front and back
 * faces. Interior holes are ignored — the outer outline is what carries the
 * shape of a piece of furniture.
 */

/** Traces the outer boundary of the mask, clockwise in image coordinates. */
export function traceContour(mask, w, h) {
  let start = -1;
  for (let i = 0; i < w * h; i++) {
    if (mask[i]) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];

  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);

  // 8-neighbourhood, clockwise from east.
  const N = [
    [1, 0], [1, 1], [0, 1], [-1, 1],
    [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];

  const sx = start % w;
  const sy = (start / w) | 0;
  const contour = [[sx, sy]];

  let cx = sx;
  let cy = sy;
  let dir = 6; // came from north

  for (let guard = 0; guard < w * h * 8; guard++) {
    let found = false;
    // Start looking just behind the incoming direction so we hug the edge.
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8;
      const nx = cx + N[d][0];
      const ny = cy + N[d][1];
      if (at(nx, ny)) {
        cx = nx;
        cy = ny;
        dir = d;
        contour.push([cx, cy]);
        found = true;
        break;
      }
    }
    if (!found) break;
    if (cx === sx && cy === sy) break;
  }

  return contour;
}

/** Douglas-Peucker on an open polyline. `eps` is in pixels. */
function simplifyOpen(points, eps) {
  if (points.length < 3) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b <= a + 1) continue;

    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;

    let worst = 0;
    let worstIdx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > worst) {
        worst = d;
        worstIdx = i;
      }
    }

    if (worst > eps && worstIdx > 0) {
      keep[worstIdx] = 1;
      stack.push([a, worstIdx], [worstIdx, b]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

/**
 * Simplifies a closed contour.
 *
 * Running Douglas-Peucker straight down a closed ring collapses it: the first
 * and last points are the same, so the anchor line has zero length and every
 * perpendicular distance is zero. Split the ring at its two most distant
 * points and simplify each half as an open polyline instead.
 */
export function simplify(points, eps) {
  if (points.length < 4) return points;

  // Drop the duplicated closing point if present.
  const pts = [...points];
  const [fx, fy] = pts[0];
  const [lx, ly] = pts[pts.length - 1];
  if (fx === lx && fy === ly) pts.pop();
  if (pts.length < 4) return pts;

  // Farthest point from the first — a stable, cheap split.
  let far = 1;
  let best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }

  const a = simplifyOpen(pts.slice(0, far + 1), eps);
  const b = simplifyOpen(pts.slice(far), eps);
  // b[0] duplicates a's last point, and b's last duplicates a[0].
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function area(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  }
  return a / 2;
}

export function isClockwise(poly) {
  return area(poly) > 0;
}

/** Ear clipping for a simple polygon. Returns index triples into `poly`. */
export function triangulate(poly) {
  const n = poly.length;
  if (n < 3) return [];

  // Work counter-clockwise.
  const idx = [...Array(n).keys()];
  if (isClockwise(poly)) idx.reverse();

  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const inside = (a, b, c, p) => {
    const d1 = cross(a, b, p);
    const d2 = cross(b, c, p);
    const d3 = cross(c, a, p);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };

  const out = [];
  const list = [...idx];
  let guard = 0;

  while (list.length > 3 && guard++ < n * n) {
    let clipped = false;

    for (let i = 0; i < list.length; i++) {
      const ia = list[(i + list.length - 1) % list.length];
      const ib = list[i];
      const ic = list[(i + 1) % list.length];
      const a = poly[ia];
      const b = poly[ib];
      const c = poly[ic];

      if (cross(a, b, c) <= 0) continue; // reflex

      let ok = true;
      for (const ip of list) {
        if (ip === ia || ip === ib || ip === ic) continue;
        if (inside(a, b, c, poly[ip])) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      out.push([ia, ib, ic]);
      list.splice(i, 1);
      clipped = true;
      break;
    }

    // Degenerate polygon: bail rather than spin.
    if (!clipped) break;
  }

  if (list.length === 3) out.push([list[0], list[1], list[2]]);
  return out;
}
