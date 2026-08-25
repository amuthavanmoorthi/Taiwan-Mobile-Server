/**
 * Background removal and silhouette extraction.
 *
 * Depot photos are shot against a floor or wall, so the background is a
 * connected region touching the border. We flood-fill inward from the border
 * and keep whatever survives. No ML weights and nothing invented - the
 * silhouette comes from the actual pixels.
 */

function px(data, i) {
  return [data[i], data[i + 1], data[i + 2]];
}

function dist2(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  // Weighted towards green, which tracks perceived difference better than raw RGB.
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

/**
 * Samples background colours from the four corners rather than the whole
 * border.
 *
 * A bench or table usually runs off the left and right edges of the frame, so
 * border-wide sampling picks up the *object* as a background colour and the
 * fill then erases the item. Corners are the last place an item reaches.
 */
function cornerSeeds(data, w, h) {
  const boxW = Math.max(4, Math.floor(w * 0.12));
  const boxH = Math.max(4, Math.floor(h * 0.12));
  const step = Math.max(1, Math.floor(Math.min(boxW, boxH) / 10));
  const boxes = [
    [0, 0],
    [w - boxW, 0],
    [0, h - boxH],
    [w - boxW, h - boxH],
  ];

  const seeds = [];
  for (const [ox, oy] of boxes) {
    for (let y = oy; y < oy + boxH; y += step) {
      for (let x = ox; x < ox + boxW; x += step) {
        seeds.push(px(data, (y * w + x) * 4));
      }
    }
  }

  // Collapse near-duplicates so the per-pixel test stays cheap.
  const kept = [];
  for (const c of seeds) {
    if (!kept.some((k) => dist2(k, c) < 300)) kept.push(c);
  }
  return kept;
}

function floodFrom(data, w, h, seeds, tol2) {
  const n = w * h;
  const bg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;

  /**
   * Candidates are compared against the sampled *background* colours, never
   * against their own neighbour. Neighbour-to-neighbour comparison drifts down
   * the JPEG gradient at the object's edge and swallows the object.
   */
  const isBackground = (idx) => {
    const c = px(data, idx * 4);
    for (const s of seeds) if (dist2(c, s) <= tol2) return true;
    return false;
  };

  const tryPush = (idx) => {
    if (bg[idx]) return;
    if (isBackground(idx)) {
      bg[idx] = 1;
      queue[qt++] = idx;
    }
  };

  for (let x = 0; x < w; x++) {
    tryPush(x);
    tryPush((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    tryPush(y * w);
    tryPush(y * w + w - 1);
  }

  while (qh < qt) {
    const idx = queue[qh++];
    const x = idx % w;
    const y = (idx / w) | 0;
    const visit = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      tryPush(ny * w + nx);
    };
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }

  const mask = new Uint8Array(n);
  let size = 0;
  for (let i = 0; i < n; i++) {
    mask[i] = bg[i] ? 0 : 1;
    if (mask[i]) size++;
  }
  return { mask, coverage: size / n };
}

/**
 * Builds the object mask, escalating tolerance until the result is plausible.
 *
 * Depot floors are speckled granite, which one fixed tolerance cannot cover:
 * too tight and the floor survives as "object", too loose and the item is
 * eaten. Sweep instead and keep the first result where the object occupies a
 * believable share of the frame.
 *
 * @returns { mask, coverage, tolerance }
 */
export function buildMask(data, w, h, tolerance = null) {
  const seeds = cornerSeeds(data, w, h);
  const ladder = tolerance ? [tolerance] : [26, 34, 44, 56, 70, 86, 104];

  let best = null;
  for (const tol of ladder) {
    const r = floodFrom(data, w, h, seeds, tol * tol * 9);
    // 3%–88% of frame: below that the item was eaten, above it the background
    // survived. Take the first plausible one - lower tolerance keeps detail.
    if (r.coverage >= 0.03 && r.coverage <= 0.88) {
      return { ...r, tolerance: tol };
    }
    if (!best || Math.abs(r.coverage - 0.35) < Math.abs(best.coverage - 0.35)) {
      best = { ...r, tolerance: tol };
    }
  }
  return best;
}

/** Keeps only the largest blob - drops specks and shadow islands. */
export function largestComponent(mask, w, h) {
  const n = w * h;
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let best = -1;
  let bestSize = 0;
  let current = 0;

  for (let start = 0; start < n; start++) {
    if (!mask[start] || label[start] !== -1) continue;
    let sp = 0;
    stack[sp++] = start;
    label[start] = current;
    let size = 0;

    while (sp > 0) {
      const idx = stack[--sp];
      size++;
      const x = idx % w;
      const y = (idx / w) | 0;
      const visit = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const ni = ny * w + nx;
        if (mask[ni] && label[ni] === -1) {
          label[ni] = current;
          stack[sp++] = ni;
        }
      };
      visit(x + 1, y);
      visit(x - 1, y);
      visit(x, y + 1);
      visit(x, y - 1);
    }

    if (size > bestSize) {
      bestSize = size;
      best = current;
    }
    current++;
  }

  const out = new Uint8Array(n);
  if (best < 0) return { mask: out, size: 0 };
  for (let i = 0; i < n; i++) out[i] = label[i] === best ? 1 : 0;
  return { mask: out, size: bestSize };
}

/**
 * Closes pinholes left by highlights, but leaves genuine gaps alone.
 *
 * A hole larger than `maxFraction` of the object is a real opening - the space
 * between chair legs, the gap under a shelf - and filling it would paint
 * background over something the buyer should see through.
 */
export function fillHoles(mask, w, h, maxFraction = 0.02) {
  const n = w * h;
  const outside = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;

  const seed = (i) => {
    if (!mask[i] && !outside[i]) {
      outside[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }

  while (sp > 0) {
    const idx = stack[--sp];
    const x = idx % w;
    const y = (idx / w) | 0;
    const visit = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      const ni = ny * w + nx;
      if (!mask[ni] && !outside[ni]) {
        outside[ni] = 1;
        stack[sp++] = ni;
      }
    };
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }

  let objectSize = 0;
  for (let i = 0; i < n; i++) if (mask[i]) objectSize++;
  const maxHole = Math.max(16, Math.floor(objectSize * maxFraction));

  // Label each enclosed hole and fill only the small ones.
  const out = new Uint8Array(mask);
  const seen = new Uint8Array(n);
  const comp = new Int32Array(n);

  for (let start = 0; start < n; start++) {
    if (mask[start] || outside[start] || seen[start]) continue;

    let sp = 0;
    let size = 0;
    comp[sp++] = start;
    seen[start] = 1;

    const cells = [];
    while (sp > 0) {
      const idx = comp[--sp];
      cells.push(idx);
      size++;
      const x = idx % w;
      const y = (idx / w) | 0;
      const visit = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const ni = ny * w + nx;
        if (!mask[ni] && !outside[ni] && !seen[ni]) {
          seen[ni] = 1;
          comp[sp++] = ni;
        }
      };
      visit(x + 1, y);
      visit(x - 1, y);
      visit(x, y + 1);
      visit(x, y - 1);
    }

    if (size <= maxHole) for (const idx of cells) out[idx] = 1;
  }

  return out;
}

/** Open then close, to smooth the edge before contouring. */
export function smooth(mask, w, h, radius = 2) {
  const morph = (src, grow) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = grow ? 0 : 1;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            const inside = nx >= 0 && ny >= 0 && nx < w && ny < h && src[ny * w + nx];
            if (grow && inside) acc = 1;
            if (!grow && !inside) acc = 0;
          }
        }
        out[y * w + x] = acc;
      }
    }
    return out;
  };

  const erode = (s) => morph(s, false);
  const dilate = (s) => morph(s, true);
  return dilate(erode(dilate(erode(mask))));
}
