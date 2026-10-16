// Rejilla de navegación y A* para que el monstruo rodee las estanterías.
import { WIDTH, DEPTH, collides, lineOfSight } from '../shared/map.js';
import { MONSTER } from '../shared/constants.js';

const CELL = 0.5;
const COLS = Math.ceil(WIDTH / CELL);
const ROWS = Math.ceil(DEPTH / CELL);
const blocked = new Uint8Array(COLS * ROWS);

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const x = (c + 0.5) * CELL, z = (r + 0.5) * CELL;
    blocked[r * COLS + c] = collides(x, z, MONSTER.radius + 0.05) ? 1 : 0;
  }
}

function cellOf(x, z) {
  const c = Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL)));
  const r = Math.min(ROWS - 1, Math.max(0, Math.floor(z / CELL)));
  return r * COLS + c;
}

// Busca la celda libre más cercana (por si el objetivo está pegado a una estantería).
function nearestFree(idx) {
  if (!blocked[idx]) return idx;
  const c0 = idx % COLS, r0 = Math.floor(idx / COLS);
  for (let rad = 1; rad < 8; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || c < 0 || r >= ROWS || c >= COLS) continue;
        const i = r * COLS + c;
        if (!blocked[i]) return i;
      }
    }
  }
  return idx;
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

// Devuelve una lista de puntos {x, z} desde (sx, sz) hasta (tx, tz), o [] si no hay camino.
export function findPath(sx, sz, tx, tz) {
  const start = nearestFree(cellOf(sx, sz));
  const goal = nearestFree(cellOf(tx, tz));
  if (start === goal) return [{ x: tx, z: tz }];

  const g = new Float32Array(COLS * ROWS).fill(Infinity);
  const came = new Int32Array(COLS * ROWS).fill(-1);
  const closed = new Uint8Array(COLS * ROWS);
  const gc = goal % COLS, gr = Math.floor(goal / COLS);
  const h = (i) => {
    const dc = Math.abs((i % COLS) - gc), dr = Math.abs(Math.floor(i / COLS) - gr);
    return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr);
  };

  const heap = new MinHeap();
  g[start] = 0;
  heap.push(start, h(start));
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const c = cur % COLS, r = Math.floor(cur / COLS);
    for (const [dc, dr, cost] of DIRS) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const n = nr * COLS + nc;
      if (blocked[n] || closed[n]) continue;
      // No cortar esquinas en diagonal
      if (dc && dr && (blocked[r * COLS + nc] || blocked[nr * COLS + c])) continue;
      const ng = g[cur] + cost;
      if (ng < g[n]) {
        g[n] = ng;
        came[n] = cur;
        heap.push(n, ng + h(n));
      }
    }
  }
  if (came[goal] === -1) return [];

  const cells = [];
  for (let i = goal; i !== -1 && i !== start; i = came[i]) cells.push(i);
  cells.reverse();
  const pts = cells.map((i) => ({ x: ((i % COLS) + 0.5) * CELL, z: (Math.floor(i / COLS) + 0.5) * CELL }));
  pts[pts.length - 1] = { x: tx, z: tz };
  return smooth(sx, sz, pts);
}

// Quita puntos intermedios cuando hay línea recta libre entre ellos.
function smooth(sx, sz, pts) {
  const out = [];
  let ax = sx, az = sz, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !clearPath(ax, az, pts[j].x, pts[j].z)) j--;
    out.push(pts[j]);
    ax = pts[j].x;
    az = pts[j].z;
    i = j + 1;
  }
  return out;
}

// Línea libre con margen para el cuerpo del monstruo (dos rayos laterales).
export function clearPath(x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz) || 1;
  const ox = (-dz / len) * MONSTER.radius, oz = (dx / len) * MONSTER.radius;
  return lineOfSight(x0, z0, x1, z1, true) &&
    lineOfSight(x0 + ox, z0 + oz, x1 + ox, z1 + oz, true) &&
    lineOfSight(x0 - ox, z0 - oz, x1 - ox, z1 - oz, true);
}

class MinHeap {
  constructor() { this.items = []; this.prios = []; }
  get size() { return this.items.length; }
  push(item, prio) {
    const a = this.items, p = this.prios;
    a.push(item); p.push(prio);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (p[parent] <= p[i]) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      [p[i], p[parent]] = [p[parent], p[i]];
      i = parent;
    }
  }
  pop() {
    const a = this.items, p = this.prios;
    const top = a[0];
    const lastI = a.pop(), lastP = p.pop();
    if (a.length) {
      a[0] = lastI; p[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && p[l] < p[m]) m = l;
        if (r < a.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        [p[i], p[m]] = [p[m], p[i]];
        i = m;
      }
    }
    return top;
  }
}
