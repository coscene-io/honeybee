// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Mask <-> polygon conversion matching OpenCV findContours (RETR_CCOMP, CHAIN_APPROX_NONE),
 * approxPolyDP and fillPoly (LINE_8). The editor uses `maskToSimplePolygons` only for the explicit
 * mask-to-polygon conversion; mask observations stay authoritative otherwise.
 *
 * Polygons are pixel coordinates of border pixel centres.
 */

import { bitmapOfRuns, runsOfBitmap, type MaskRuns } from "./maskCodec";

export type PixelPolygon = [number, number][];

type Contour = { pts: [number, number][]; isHole: boolean; parent: number };
type BorderInfo = { isHole: boolean; parent: number; idx: number };

const CODE_DELTAS: readonly [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

type BitmapBox = { bits: Uint8Array; x0: number; y0: number; w: number; h: number };

function findContours(box: BitmapBox): Contour[] {
  if (box.w === 0) {
    return [];
  }
  const stride = box.w + 2;
  const w = box.w;
  const h = box.h;
  const img = new Int32Array(stride * (h + 2));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      img[(y + 1) * stride + x + 1] = box.bits[y * w + x]!;
    }
  }
  const delta = CODE_DELTAS.map(([dx, dy]) => dy * stride + dx);
  const info: BorderInfo[] = [
    { isHole: false, parent: 0, idx: -1 },
    { isHole: true, parent: 0, idx: -1 },
  ];
  const out: Contour[] = [];

  const follow = (
    x0: number,
    y0: number,
    kind: "outer" | "hole",
    nbd: number,
  ): [number, number][] => {
    const pts: [number, number][] = [];
    const i0 = y0 * stride + x0;
    const sEnd = kind === "hole" ? 0 : 4;
    let s = sEnd;
    let i1 = -1;
    for (;;) {
      s = (s - 1) & 7;
      const c = i0 + delta[s]!;
      if (img[c] !== 0) {
        i1 = c;
        break;
      }
      if (s === sEnd) {
        break;
      }
    }
    if (i1 < 0) {
      img[i0] = -nbd;
      pts.push([x0 - 1 + box.x0, y0 - 1 + box.y0]);
      return pts;
    }
    let i3 = i0;
    let px = x0 - 1 + box.x0;
    let py = y0 - 1 + box.y0;
    for (;;) {
      const sPrev = s;
      let i4: number;
      for (;;) {
        s++;
        i4 = i3 + delta[s & 7]!;
        if (img[i4] !== 0) {
          break;
        }
      }
      s &= 7;
      if (s - 1 >= 0 && s - 1 < sPrev) {
        img[i3] = -nbd;
      } else if (img[i3] === 1) {
        img[i3] = nbd;
      }
      pts.push([px, py]);
      px += CODE_DELTAS[s]![0];
      py += CODE_DELTAS[s]![1];
      if (i4 === i0 && i3 === i1) {
        break;
      }
      i3 = i4;
      s = (s + 4) & 7;
    }
    return pts;
  };

  let nbd = 1;
  for (let y = 1; y <= h; y++) {
    const base = y * stride;
    let lnbd = 1;
    let prev = 0;
    for (let x = 1; x <= w; x++) {
      let p = img[base + x]!;
      if (p === 0) {
        if (prev === 0) {
          while (x <= w && img[base + x] === 0) {
            x++;
          }
          if (x > w) {
            break;
          }
          p = img[base + x]!;
        }
      } else if (p === 1 && prev !== 0) {
        let j = x + 1;
        while (img[base + j] === 1) {
          j++;
        }
        x = j - 1;
        prev = 1;
        continue;
      }
      let isHole: boolean;
      if (prev === 0 && p === 1) {
        isHole = false;
      } else if (p === 0 && prev >= 1) {
        isHole = true;
      } else {
        if (p !== 0 && p !== 1) {
          lnbd = Math.abs(p);
        }
        prev = p;
        continue;
      }
      nbd++;
      const sx = isHole ? x - 1 : x;
      let par = lnbd;
      if (info[lnbd]!.isHole === isHole) {
        par = info[lnbd]!.parent;
      }
      const parent = isHole && par > 1 ? info[par]!.idx : -1;
      info.push({ isHole, parent: par, idx: out.length });
      const pts = follow(sx, y, isHole ? "hole" : "outer", nbd);
      out.push({ pts, isHole, parent });
      lnbd = nbd;
      prev = img[base + x]!;
    }
  }
  const n = out.length;
  out.reverse();
  for (const contour of out) {
    if (contour.parent >= 0) {
      contour.parent = n - 1 - contour.parent;
    }
  }
  return out;
}

function dist2(p: [number, number], q: [number, number]): number {
  const dx = p[0] - q[0];
  const dy = p[1] - q[1];
  return dx * dx + dy * dy;
}

function anchors(pts: [number, number][]): { a: number; b: number; span: number } {
  const n = pts.length;
  let pos = 0;
  let off = 0;
  let span = 0;
  for (let i = 0; i < 3; i++) {
    pos = (pos + off) % n;
    span = 0;
    off = 0;
    for (let j = 1; j < n; j++) {
      const d = dist2(pts[(pos + j) % n]!, pts[pos]!);
      if (d > span) {
        span = d;
        off = j;
      }
    }
  }
  return { a: pos, b: (pos + off) % n, span };
}

function ringArc(pts: [number, number][], i: number, j: number): [number, number][] {
  if (i <= j) {
    return pts.slice(i, j + 1);
  }
  return [...pts.slice(i), ...pts.slice(0, j + 1)];
}

function simplifyArc(pts: [number, number][], eps: number): [number, number][] {
  const n = pts.length;
  if (n < 3) {
    return pts;
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const eps2 = eps * eps;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [si, sj] = stack.pop()!;
    if (sj <= si + 1) {
      continue;
    }
    const sx = pts[si]![0];
    const sy = pts[si]![1];
    const dx = pts[sj]![0] - sx;
    const dy = pts[sj]![1] - sy;
    let maxd = -1;
    let pos = -1;
    if (dx === 0 && dy === 0) {
      for (let k = si + 1; k < sj; k++) {
        const ex = pts[k]![0] - sx;
        const ey = pts[k]![1] - sy;
        const d = ex * ex + ey * ey;
        if (d > maxd) {
          maxd = d;
          pos = k;
        }
      }
      if (maxd <= eps2) {
        continue;
      }
    } else {
      for (let k = si + 1; k < sj; k++) {
        const d = Math.abs((pts[k]![1] - sy) * dx - (pts[k]![0] - sx) * dy);
        if (d > maxd) {
          maxd = d;
          pos = k;
        }
      }
      if (maxd * maxd <= eps2 * (dx * dx + dy * dy)) {
        continue;
      }
    }
    keep[pos] = 1;
    stack.push([si, pos], [pos, sj]);
  }
  return pts.filter((_, i) => keep[i] === 1);
}

function pruneCollinear(p: [number, number][], eps: number): [number, number][] {
  const count = p.length;
  if (count <= 2) {
    return p;
  }
  const dst = p.slice();
  let n = count;
  let pos = count - 1;
  const read = () => {
    const v = dst[pos]!;
    pos++;
    if (pos >= count) {
      pos = 0;
    }
    return v;
  };
  let start = read();
  let wpos = pos;
  let pt = read();
  const write = (v: [number, number]) => {
    dst[wpos] = v;
    wpos++;
    if (wpos >= count) {
      wpos = 0;
    }
  };
  for (let i = 0; i < count && n > 2; i++) {
    const end = read();
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const d = (pt[0] - start[0]) * dy - (pt[1] - start[1]) * dx;
    const ip = (pt[0] - start[0]) * (end[0] - pt[0]) + (pt[1] - start[1]) * (end[1] - pt[1]);
    if (d * d <= 0.5 * eps * eps * (dx * dx + dy * dy) && dx !== 0 && dy !== 0 && ip >= 0) {
      n--;
      start = end;
      write(start);
      pt = read();
      i++;
      continue;
    }
    start = pt;
    write(start);
    pt = end;
  }
  return dst.slice(0, n);
}

function simplifyClosed(pts: [number, number][], eps: number): [number, number][] {
  const n = pts.length;
  if (n <= 2) {
    return pts.slice();
  }
  const { a, b, span } = anchors(pts);
  if (span <= eps * eps) {
    return [pts[a]!];
  }
  const head = simplifyArc(ringArc(pts, a, b), eps);
  const tail = simplifyArc(ringArc(pts, b, a), eps);
  return pruneCollinear([...head.slice(0, -1), ...tail.slice(0, -1)], eps);
}

/**
 * Columns that cut every hole of a row-major bitmap: holes are the 4-connected background regions
 * not reachable from outside (8-connected foreground, as findContours sees it). Each hole spans a
 * contiguous column range; the fewest columns stabbing all ranges are picked greedily.
 */
function holeCutColumns(bits: Uint8Array, w: number, h: number): number[] {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const visit = (start: number, onPixel?: (x: number) => void): boolean => {
    let open = false;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      onPixel?.(x);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        open = true;
      }
      // Four neighbours, inline: this runs once per background pixel of the bounding box.
      if (x > 0) {
        push(p - 1);
      }
      if (x < w - 1) {
        push(p + 1);
      }
      if (y > 0) {
        push(p - w);
      }
      if (y < h - 1) {
        push(p + w);
      }
    }
    return open;
  };
  function push(q: number): void {
    if (seen[q] === 0 && bits[q] === 0) {
      seen[q] = 1;
      stack.push(q);
    }
  }
  const ranges: [number, number][] = [];
  for (let p = 0; p < w * h; p++) {
    if (bits[p] !== 0 || seen[p] !== 0) {
      continue;
    }
    let lo = w;
    let hi = -1;
    const open = visit(p, (x) => {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    });
    if (!open) {
      ranges.push([lo, hi]);
    }
  }
  ranges.sort((a, b) => a[1] - b[1]);
  const cuts: number[] = [];
  for (const [lo, hi] of ranges) {
    if (cuts.length === 0 || cuts[cuts.length - 1]! < lo) {
      cuts.push(hi);
    }
  }
  return cuts;
}

function pointKey(p: [number, number]): string {
  return `${p[0]}:${p[1]}`;
}

function ringArea2(ring: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    area += p[0] * q[1] - q[0] * p[1];
  }
  return area;
}

/**
 * Split a traced ring into rings with distinct vertices and no backtracking edge. An 8-connected
 * contour revisits pinch pixels (two lobes touching diagonally, a one-pixel neck) and walks out and
 * back along one-pixel filaments; the contract rejects both. Pinches split into separate rings,
 * which union to the same area; filaments have no area and drop out.
 */
function splitRing(ring: [number, number][]): [number, number][][] {
  const out: [number, number][][] = [];
  const work = [ring];
  while (work.length > 0) {
    let r = work.pop()!;
    r = r.filter((p, i) => pointKey(p) !== pointKey(r[(i + 1) % r.length]!));
    const seen = new Map<string, number>();
    let split = false;
    for (let i = 0; i < r.length; i++) {
      const key = pointKey(r[i]!);
      const j = seen.get(key);
      if (j != undefined) {
        work.push(r.slice(j, i), [...r.slice(i), ...r.slice(0, j)]);
        split = true;
        break;
      }
      seen.set(key, i);
    }
    if (split) {
      continue;
    }
    const n = r.length;
    const spike = r.findIndex((a, i) => {
      const prev = r[(i + n - 1) % n]!;
      const b = r[(i + 1) % n]!;
      const cross = (a[0] - prev[0]) * (b[1] - prev[1]) - (a[1] - prev[1]) * (b[0] - prev[0]);
      const dot = (prev[0] - a[0]) * (b[0] - a[0]) + (prev[1] - a[1]) * (b[1] - a[1]);
      return cross === 0 && dot >= 0;
    });
    if (spike >= 0 && n > 2) {
      work.push(r.filter((_, i) => i !== spike));
      continue;
    }
    if (n >= 3 && ringArea2(r) !== 0) {
      out.push(r);
    }
  }
  return out;
}

function ringsAreSimple(rings: [number, number][][]): boolean {
  return rings.every(ringIsSimple);
}

/**
 * No two non-adjacent edges of the ring touch. Edges are bucketed into a uniform grid of about
 * one cell per edge and only edges sharing a cell are compared, so a traced 1080p contour with
 * thousands of vertices costs near-linear time instead of the all-pairs O(n²).
 */
function ringIsSimple(ring: [number, number][]): boolean {
  const n = ring.length;
  if (n < 4) {
    // Every pair of a triangle's edges is adjacent.
    return true;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const cell = Math.max(1, Math.ceil(Math.max(maxX - minX, maxY - minY) / Math.sqrt(n)));
  const columns = Math.floor((maxX - minX) / cell) + 1;
  const lo = new Int32Array(n * 2);
  const cells = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const cx0 = Math.floor((Math.min(a[0], b[0]) - minX) / cell);
    const cx1 = Math.floor((Math.max(a[0], b[0]) - minX) / cell);
    const cy0 = Math.floor((Math.min(a[1], b[1]) - minY) / cell);
    const cy1 = Math.floor((Math.max(a[1], b[1]) - minY) / cell);
    lo[i * 2] = cx0;
    lo[i * 2 + 1] = cy0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cy * columns + cx;
        const list = cells.get(key);
        if (list) {
          list.push(i);
        } else {
          cells.set(key, [i]);
        }
      }
    }
  }
  for (const [key, list] of cells) {
    const cx = key % columns;
    const cy = (key - cx) / columns;
    for (let p = 0; p < list.length; p++) {
      const i = list[p]!;
      for (let q = p + 1; q < list.length; q++) {
        const j = list[q]!;
        const gap = Math.abs(i - j);
        if (gap === 1 || gap === n - 1) {
          continue;
        }
        // Test each pair once: in the first cell both edges share.
        if (
          cx !== Math.max(lo[i * 2]!, lo[j * 2]!) ||
          cy !== Math.max(lo[i * 2 + 1]!, lo[j * 2 + 1]!)
        ) {
          continue;
        }
        if (segmentsTouch(ring[i]!, ring[(i + 1) % n]!, ring[j]!, ring[(j + 1) % n]!)) {
          return false;
        }
      }
    }
  }
  return true;
}

function segmentsTouch(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const cross = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const within = (p: [number, number], q: [number, number], r: [number, number]) =>
    r[0] >= Math.min(p[0], q[0]) &&
    r[0] <= Math.max(p[0], q[0]) &&
    r[1] >= Math.min(p[1], q[1]) &&
    r[1] <= Math.max(p[1], q[1]);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return (
    (abC === 0 && within(a, b, c)) ||
    (abD === 0 && within(a, b, d)) ||
    (cdA === 0 && within(c, d, a)) ||
    (cdB === 0 && within(c, d, b)) ||
    (Math.sign(abC) !== Math.sign(abD) && Math.sign(cdA) !== Math.sign(cdB))
  );
}

/**
 * Mask to simple polygons whose union is the mask, as the annotation contract requires: every
 * polygon has distinct vertices, no backtracking edge and no self-intersection, and there are no
 * holes (polygons union, they do not XOR). A component with holes is cut into vertical strips that
 * overlap by one column at a column through each hole, which opens every hole into a notch; strips
 * then trace like hole-free masks. Rings are Douglas-Peucker simplified with eps like
 * maskToPolygons; a ring that simplification makes self-intersecting falls back to its exact trace.
 */
export function maskToSimplePolygons(mask: MaskRuns, eps = 1): PixelPolygon[] {
  const box = bitmapOfRuns(mask);
  if (box.w === 0) {
    return [];
  }
  const cuts = holeCutColumns(box.bits, box.w, box.h);
  const bounds = [0, ...cuts, box.w - 1];
  const out: PixelPolygon[] = [];
  for (let s = 0; s + 1 < bounds.length; s++) {
    const lo = bounds[s]!;
    const hi = bounds[s + 1]!;
    const w = hi - lo + 1;
    const bits = new Uint8Array(w * box.h);
    for (let y = 0; y < box.h; y++) {
      bits.set(box.bits.subarray(y * box.w + lo, y * box.w + hi + 1), y * w);
    }
    // Trace the strip bitmap directly; empty rows and columns only cost a scan.
    for (const contour of findContours({ bits, x0: box.x0 + lo, y0: box.y0, w, h: box.h })) {
      if (contour.isHole) {
        continue;
      }
      const simplified = splitRing(simplifyClosed(contour.pts, eps));
      const rings = ringsAreSimple(simplified) ? simplified : splitRing(contour.pts);
      out.push(...rings.map((ring) => ring.map(([x, y]): [number, number] => [x, y])));
    }
  }
  return out;
}

const XY_SHIFT = 16;
const XY_ONE = 1 << XY_SHIFT;

function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) {
    return floor;
  }
  if (diff > 0.5) {
    return floor + 1;
  }
  return floor % 2 === 0 ? floor : floor + 1;
}

function drawLine(
  bits: Uint8Array,
  w: number,
  h: number,
  ax0: number,
  ay0: number,
  ax1: number,
  ay1: number,
): void {
  let x0 = ax0;
  let y0 = ay0;
  let x1 = ax1;
  let y1 = ay1;
  if (x1 < x0) {
    [x0, y0, x1, y1] = [x1, y1, x0, y0];
  }
  let dx = x1 - x0;
  let dy = y1 - y0;
  let sy = 1;
  if (dy < 0) {
    sy = -1;
    dy = -dy;
  }
  let majX = 1;
  let majY = 0;
  let minX = 0;
  let minY = sy;
  if (dy > dx) {
    [dx, dy] = [dy, dx];
    majX = 0;
    majY = sy;
    minX = 1;
    minY = 0;
  }
  let err = dx - 2 * dy;
  let x = x0;
  let y = y0;
  for (let i = 0; i <= dx; i++) {
    if (x >= 0 && x < w && y >= 0 && y < h) {
      bits[y * w + x] = 1;
    }
    const step = err < 0;
    err -= 2 * dy;
    if (step) {
      err += 2 * dx;
      x += minX;
      y += minY;
    }
    x += majX;
    y += majY;
  }
}

type Edge = { y0: number; y1: number; x: number; dx: number };

function fillPolygon(bits: Uint8Array, w: number, h: number, v: [number, number][]): void {
  const n = v.length;
  if (n === 0) {
    return;
  }
  let p0 = v[n - 1]!;
  for (const p1 of v) {
    drawLine(bits, w, h, p0[0], p0[1], p1[0], p1[1]);
    p0 = p1;
  }
  if (n < 2) {
    return;
  }
  const edges: Edge[] = [];
  p0 = v[n - 1]!;
  for (const p1 of v) {
    if (p0[1] !== p1[1]) {
      const x0 = p0[0] * XY_ONE;
      const x1 = p1[0] * XY_ONE;
      const dx = Math.trunc((x1 - x0) / (p1[1] - p0[1]));
      edges.push(
        p0[1] < p1[1] ? { y0: p0[1], y1: p1[1], x: x0, dx } : { y0: p1[1], y1: p0[1], x: x1, dx },
      );
    }
    p0 = p1;
  }
  if (edges.length < 2) {
    return;
  }
  edges.sort((a, b) => a.y0 - b.y0);
  let yLo = edges[0]!.y0;
  let yHi = 0;
  for (const e of edges) {
    yHi = Math.max(yHi, e.y1);
  }
  yLo = Math.max(yLo, 0);
  yHi = Math.min(yHi, h);
  let active: Edge[] = [];
  let k = 0;
  const xs: number[] = [];
  for (let y = yLo; y < yHi; y++) {
    while (k < edges.length && edges[k]!.y0 <= y) {
      if (edges[k]!.y1 > y) {
        active.push(edges[k]!);
      }
      k++;
    }
    active = active.filter((e) => e.y1 > y);
    if (active.length < 2) {
      continue;
    }
    xs.length = 0;
    for (const e of active) {
      xs.push(e.x + (y - e.y0) * e.dx);
    }
    xs.sort((a, b) => a - b);
    const row = y * w;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      let x1 = Math.floor((xs[i]! + XY_ONE - 1) / XY_ONE);
      let x2 = Math.floor(xs[i + 1]! / XY_ONE);
      if (x1 >= w || x2 < 0) {
        continue;
      }
      x1 = Math.max(x1, 0);
      x2 = Math.min(x2, w - 1);
      bits.fill(1, row + x1, row + x2 + 1);
    }
  }
}

/**
 * Rasterize pixel-coordinate polygons into a width × height mask: vertices rounded half to even,
 * each polygon even-odd filled with its outline included, results unioned (cv2.fillPoly LINE_8).
 */
export function polygonsToRuns(polygons: PixelPolygon[], width: number, height: number): MaskRuns {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  const rounded = polygons.map((polygon) =>
    polygon.map(([x, y]): [number, number] => {
      const rx = roundHalfEven(x);
      const ry = roundHalfEven(y);
      x0 = Math.min(x0, rx);
      y0 = Math.min(y0, ry);
      x1 = Math.max(x1, rx);
      y1 = Math.max(y1, ry);
      return [rx, ry];
    }),
  );
  x0 = Math.max(x0, 0);
  y0 = Math.max(y0, 0);
  x1 = Math.min(x1, width - 1);
  y1 = Math.min(y1, height - 1);
  if (x1 < x0 || y1 < y0) {
    return runsOfBitmap(new Uint8Array(0), { x0: 0, y0: 0, w: 0, h: 0 }, width, height);
  }
  // Rasterize only the clipped bounding box. Pixels outside it are outside the frame or the
  // polygons, so translating keeps fillPoly's frame clipping exact.
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const bits = new Uint8Array(w * h);
  const [left, top] = [x0, y0];
  for (const polygon of rounded) {
    fillPolygon(
      bits,
      w,
      h,
      polygon.map(([x, y]) => [x - left, y - top]),
    );
  }
  return runsOfBitmap(bits, { x0, y0, w, h }, width, height);
}
