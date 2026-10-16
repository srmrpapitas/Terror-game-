// Mapa del supermercado, compartido por el servidor (IA, colisiones) y el cliente (render).
// Coordenadas en metros: x de 0 a WIDTH (oeste a este), z de 0 a DEPTH (norte a sur).
// Cada obstáculo es una caja alineada con los ejes: { x, z, w, d, h, kind, tall }.

export const WIDTH = 60;
export const DEPTH = 40;
export const CEILING = 4.2;

export const SPAWN = { x: 20, z: 37 };
export const MONSTER_SPAWN = { x: 30, z: 3 };
// Zona de salida (cajas y puerta), se gana entrando aquí con la lista completa.
export const EXIT_ZONE = { x0: 2, x1: 12, z0: 35, z1: 40 };

function box(x0, z0, x1, z1, h, kind, tall = true) {
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, h, kind, tall };
}

function buildObstacles() {
  const o = [];
  const T = 0.4; // grosor de pared

  // Paredes exteriores
  o.push(box(-T, -T, WIDTH + T, 0, CEILING, 'wall'));
  o.push(box(-T, DEPTH, WIDTH + T, DEPTH + T, CEILING, 'wall'));
  o.push(box(-T, 0, 0, DEPTH, CEILING, 'wall'));
  o.push(box(WIDTH, 0, WIDTH + T, DEPTH, CEILING, 'wall'));

  // Pared del almacén (z = 6) con dos puertas: x 14..17 y x 40..43
  o.push(box(0, 6, 14, 6 + T, CEILING, 'wall'));
  o.push(box(17, 6, 40, 6 + T, CEILING, 'wall'));
  o.push(box(43, 6, 50, 6 + T, CEILING, 'wall'));
  // Pared lateral del almacén: separa la zona de frescos (x > 50)
  o.push(box(50, 0, 50 + T, 6 + T, CEILING, 'wall'));

  // Cajas apiladas en el almacén
  const crates = [
    [3, 1.2, 6, 3], [9, 2.5, 11, 4.5], [20, 1, 23, 2.5], [25, 3.5, 28, 5],
    [33, 1, 36, 2.5], [45, 2, 48, 4], [52, 2, 55, 4],
  ];
  for (const [x0, z0, x1, z1] of crates) o.push(box(x0, z0, x1, z1, 2.4, 'crate'));

  // Pasillos: estanterías altas norte-sur con un corte central en z 17..19.5
  for (let x = 6; x <= 46; x += 4) {
    o.push(box(x - 0.5, 9, x + 0.5, 17, 2.6, 'shelf'));
    o.push(box(x - 0.5, 19.5, x + 0.5, 28, 2.6, 'shelf'));
  }

  // Zona de frescos (este): neveras contra la pared y dos islas altas
  o.push(box(58.8, 8, 60, 30, 2.4, 'fridge'));
  o.push(box(52, 10, 54, 16, 2.4, 'shelf'));
  o.push(box(52, 21, 54, 27, 2.4, 'shelf'));

  // Estanterías bajas de promociones cerca de las cajas (no tapan la vista)
  o.push(box(18, 30.5, 26, 31.5, 1.1, 'promo', false));
  o.push(box(32, 30.5, 40, 31.5, 1.1, 'promo', false));

  // Cajas registradoras (bajas)
  for (let x = 4; x <= 28; x += 6) o.push(box(x, 33.5, x + 3, 34.5, 1.0, 'checkout', false));

  // Neveras contra la pared norte de la sala principal, entre las puertas del almacén
  o.push(box(20, 6.4, 37, 7.4, 2.4, 'fridge'));

  return o;
}

export const OBSTACLES = buildObstacles();

// Altura (m) de la cara superior de cada balda de las estanterías.
export const SHELF_LEVELS = [0.12, 0.7, 1.28, 1.86, 2.44];

// Sitios sobre las baldas donde pueden aparecer productos de la lista.
function buildItemSpots() {
  const spots = [];
  for (const ob of OBSTACLES) {
    if (ob.kind !== 'shelf') continue;
    const alongZ = ob.d > ob.w;
    const len = alongZ ? ob.d : ob.w;
    const depth = alongZ ? ob.w : ob.d;
    for (let t = 1.0; t < len - 0.6; t += 1.9) {
      for (const side of [-1, 1]) {
        // En la mitad de la balda que da a cada pasillo
        const off = side * depth * 0.28;
        const x = alongZ ? ob.x + off : ob.x - ob.w / 2 + t;
        const z = alongZ ? ob.z - ob.d / 2 + t : ob.z + off;
        const level = SHELF_LEVELS[1 + (spots.length % 3)];
        spots.push({ x, z, y: level + 0.17, side, alongZ });
      }
    }
  }
  return spots;
}

export const PATROL_POINTS = [
  { x: 4, z: 12 }, { x: 4, z: 26 }, { x: 16, z: 18 }, { x: 28, z: 18 }, { x: 40, z: 18 },
  { x: 50, z: 18 }, { x: 56, z: 8 }, { x: 56, z: 30 }, { x: 30, z: 30 }, { x: 12, z: 30 },
  { x: 24, z: 12 }, { x: 36, z: 25 }, { x: 15.5, z: 3 }, { x: 41.5, z: 3 }, { x: 48, z: 32 },
];

export const PRODUCTS = [
  { name: 'Leche', color: 0xf2f2f2 },
  { name: 'Pan', color: 0xc8893a },
  { name: 'Huevos', color: 0xe9d7b4 },
  { name: 'Manzanas', color: 0xd22a2a },
  { name: 'Cereales', color: 0xf0b323 },
  { name: 'Café', color: 0x5a3a22 },
  { name: 'Detergente', color: 0x2a7bd2 },
  { name: 'Pizza congelada', color: 0xe86a1c },
  { name: 'Agua', color: 0x8fd3ff },
  { name: 'Papel higiénico', color: 0xfafafa },
  { name: 'Queso', color: 0xffd84a },
  { name: 'Chocolate', color: 0x3b2314 },
];

export const ITEMS_PER_ROUND = 8;

// ---- Geometría ----

export function collides(x, z, r) {
  for (const o of OBSTACLES) {
    if (Math.abs(x - o.x) < o.w / 2 + r && Math.abs(z - o.z) < o.d / 2 + r) return true;
  }
  return false;
}

// Empuja un círculo (x, z, r) fuera de los obstáculos. Devuelve la posición corregida.
export function resolveCircle(x, z, r) {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const o of OBSTACLES) {
      const hw = o.w / 2, hd = o.d / 2;
      const cx = Math.max(o.x - hw, Math.min(x, o.x + hw));
      const cz = Math.max(o.z - hd, Math.min(z, o.z + hd));
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // Centro dentro de la caja: salir por el lado más cercano
        const pushes = [
          [o.x - hw - r - x, 0], [o.x + hw + r - x, 0],
          [0, o.z - hd - r - z], [0, o.z + hd + r - z],
        ];
        pushes.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        x += pushes[0][0];
        z += pushes[0][1];
      }
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}

// ¿Hay línea de visión entre dos puntos? Solo bloquean los obstáculos altos,
// salvo con includeLow (para saber si se puede caminar en línea recta).
export function lineOfSight(x0, z0, x1, z1, includeLow = false) {
  const dx = x1 - x0, dz = z1 - z0;
  for (const o of OBSTACLES) {
    if (!o.tall && !includeLow) continue;
    if (segmentHitsBox(x0, z0, dx, dz, o)) return false;
  }
  return true;
}

function segmentHitsBox(x0, z0, dx, dz, o) {
  let tmin = 0, tmax = 1;
  const minX = o.x - o.w / 2, maxX = o.x + o.w / 2;
  const minZ = o.z - o.d / 2, maxZ = o.z + o.d / 2;
  for (const [p, d, lo, hi] of [[x0, dx, minX, maxX], [z0, dz, minZ, maxZ]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
    } else {
      let t1 = (lo - p) / d, t2 = (hi - p) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

export function inExitZone(x, z) {
  return x >= EXIT_ZONE.x0 && x <= EXIT_ZONE.x1 && z >= EXIT_ZONE.z0 && z <= EXIT_ZONE.z1;
}

export const ITEM_SPOTS = buildItemSpots();
