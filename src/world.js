// Construye el supermercado en Three.js a partir de shared/map.js.
import * as THREE from 'three';
import { WIDTH, DEPTH, CEILING, OBSTACLES, EXIT_ZONE, SHELF_LEVELS, ITEM_SPOTS } from '../shared/map.js';

const FOG_COLOR = 0x030405;

export function buildWorld(scene, { lowQuality }) {
  scene.background = new THREE.Color(FOG_COLOR);
  // Niebla: empieza a espesar a ~9 m y es opaca hacia los 32 m (ver documento de diseño)
  scene.fog = new THREE.Fog(FOG_COLOR, lowQuality ? 7 : 9, lowQuality ? 30 : 34);

  scene.add(new THREE.HemisphereLight(0x6a7488, 0x1a1410, 0.05));

  // Suelo de baldosas y techo
  const floorTex = canvasTexture(256, (g, s) => {
    g.fillStyle = '#6f6a60';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#5d584f';
    g.fillRect(0, 0, s / 2, s / 2);
    g.fillRect(s / 2, s / 2, s / 2, s / 2);
    g.strokeStyle = '#3c3933';
    g.lineWidth = 3;
    g.strokeRect(0, 0, s, s);
    dirt(g, s, 260);
  });
  floorTex.repeat.set(WIDTH / 2, DEPTH / 2);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH, DEPTH),
    new THREE.MeshLambertMaterial({ map: floorTex }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(WIDTH / 2, 0, DEPTH / 2);
  scene.add(floor);

  // Techo de placas de escayola
  const ceilingTex = canvasTexture(128, (g, sz) => {
    g.fillStyle = '#3b3a37';
    g.fillRect(0, 0, sz, sz);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`;
      g.fillRect(Math.random() * sz, Math.random() * sz, 2, 2);
    }
    g.strokeStyle = '#1e1d1b';
    g.lineWidth = 4;
    g.strokeRect(0, 0, sz, sz);
  });
  ceilingTex.repeat.set(WIDTH / 1.2, DEPTH / 1.2);
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH, DEPTH),
    new THREE.MeshLambertMaterial({ map: ceilingTex }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(WIDTH / 2, CEILING, DEPTH / 2);
  scene.add(ceiling);

  // Obstáculos
  const mats = {
    wall: new THREE.MeshLambertMaterial({ map: wallpaperTexture() }),
    fridge: new THREE.MeshLambertMaterial({ map: fridgeTexture(), emissive: 0x9fd8ff, emissiveIntensity: 0.07 }),
    crate: new THREE.MeshLambertMaterial({ map: crateTexture() }),
    checkout: new THREE.MeshLambertMaterial({ color: 0x3a3f46 }),
    promo: new THREE.MeshLambertMaterial({ color: 0xb0281e }),
  };
  const productSlots = [];
  const shelfParts = new THREE.Group();
  const metal = new THREE.MeshLambertMaterial({ map: pegboardTexture() });
  const boardMat = new THREE.MeshLambertMaterial({ color: 0xb8bcc2 });
  const postMat = new THREE.MeshLambertMaterial({ color: 0x55595f });
  for (const o of OBSTACLES) {
    if (o.kind === 'shelf') {
      buildShelf(shelfParts, o, { metal, boardMat, postMat });
      productSlots.push(o);
      continue;
    }
    const geo = new THREE.BoxGeometry(o.w, o.h, o.d);
    // Que el papel pintado y las cajas se repitan según el tamaño, no se estiren
    if (o.kind === 'wall') scaleUV(geo, Math.max(o.w, o.d) / 2.5, o.h / 2.5);
    if (o.kind === 'fridge') scaleUV(geo, Math.max(o.w, o.d) / 1.4, 1);
    const mesh = new THREE.Mesh(geo, mats[o.kind] || mats.checkout);
    mesh.position.set(o.x, o.h / 2, o.z);
    scene.add(mesh);
    if (o.kind === 'promo') productSlots.push(o);
  }
  scene.add(shelfParts);
  scene.add(buildProducts(productSlots));
  scene.add(buildSigns());

  // Zona de salida: se ilumina en verde cuando la lista está completa
  const exitMat = new THREE.MeshBasicMaterial({ color: 0x1f8f3a, transparent: true, opacity: 0, fog: false });
  const exit = new THREE.Mesh(
    new THREE.PlaneGeometry(EXIT_ZONE.x1 - EXIT_ZONE.x0, EXIT_ZONE.z1 - EXIT_ZONE.z0),
    exitMat,
  );
  exit.rotation.x = -Math.PI / 2;
  exit.position.set((EXIT_ZONE.x0 + EXIT_ZONE.x1) / 2, 0.02, (EXIT_ZONE.z0 + EXIT_ZONE.z1) / 2);
  scene.add(exit);

  // Fluorescentes: paneles en el techo + unas pocas luces reales que parpadean
  const lamps = buildLamps(scene, lowQuality);

  return {
    lamps,
    setExitOpen(open, t) {
      exitMat.opacity = open ? 0.25 + Math.sin(t * 4) * 0.12 : 0;
    },
  };
}

function buildLamps(scene, lowQuality) {
  const panelGeo = new THREE.BoxGeometry(0.4, 0.06, 2.4);
  const panelOn = new THREE.MeshBasicMaterial({ color: 0x9aa2b0 });
  const panelOff = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const lamps = [];
  const spots = [];
  for (let x = 8; x <= 52; x += 8) {
    for (const z of [12, 24, 32]) spots.push({ x, z });
  }
  spots.push({ x: 15, z: 3 }, { x: 41, z: 3 });
  const maxLights = lowQuality ? 5 : 10;
  // Reparte las luces reales entre los paneles para que haya zonas oscuras
  const lit = new Set();
  for (let i = 0; i < maxLights; i++) lit.add(Math.floor((i * spots.length) / maxLights + 1) % spots.length);

  spots.forEach((s, i) => {
    const panel = new THREE.Mesh(panelGeo, panelOn);
    panel.position.set(s.x, CEILING - 0.05, s.z);
    scene.add(panel);
    let light = null;
    if (lit.has(i)) {
      light = new THREE.PointLight(0xdfe8ff, 3, 8, 1.8);
      light.position.set(s.x, CEILING - 0.4, s.z);
      scene.add(light);
    }
    lamps.push({
      panel, light, base: light ? light.intensity : 0,
      flicky: i % 3 === 1, // algunos parpadean más
      setOn(on) {
        panel.material = on ? panelOn : panelOff;
        if (light) light.intensity = on ? this.base : 0;
      },
    });
  });
  return lamps;
}

// Productos decorativos en las estanterías (un único InstancedMesh, muy barato de dibujar).
function buildProducts(shelves) {
  const palette = [0xc0392b, 0x2980b9, 0xf1c40f, 0x27ae60, 0xe67e22, 0xecf0f1, 0x8e44ad, 0x16a085, 0xd35400];
  const transforms = [];
  for (const o of shelves) {
    const alongZ = o.d > o.w;
    const len = alongZ ? o.d : o.w;
    const levels = o.kind === 'promo' ? [o.h] : SHELF_LEVELS.slice(0, 4);
    for (const y of levels) {
      for (let t = 0.25; t < len - 0.2; t += 0.3 + Math.random() * 0.1) {
        if (Math.random() < 0.15) continue; // huecos vacíos
        for (const side of o.kind === 'promo' ? [0] : [-1, 1]) {
          const h = Math.min(0.2 + Math.random() * 0.3, 0.5);
          const off = side * (alongZ ? o.w : o.d) * 0.28;
          const x = alongZ ? o.x + off : o.x - o.w / 2 + t;
          const z = alongZ ? o.z - o.d / 2 + t : o.z + off;
          // Deja libre el hueco donde puede aparecer un producto de la lista
          if (o.kind !== 'promo' && ITEM_SPOTS.some((sp) => Math.abs(sp.y - 0.17 - y) < 0.05 && Math.hypot(sp.x - x, sp.z - z) < 0.35)) continue;
          transforms.push({ x, y: y + h / 2, z, h, color: palette[Math.floor(Math.random() * palette.length)] });
        }
      }
    }
  }
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.22, 1, 0.22),
    new THREE.MeshLambertMaterial(),
    transforms.length,
  );
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  transforms.forEach((tr, i) => {
    m.makeScale(1, tr.h, 1).setPosition(tr.x, tr.y, tr.z);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setHex(tr.color));
  });
  return mesh;
}

function buildSigns() {
  const group = new THREE.Group();
  const sign = (text, x, z, rotY, color) => {
    const tex = canvasTexture(512, (g, s) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, s, s);
      g.fillStyle = color;
      g.font = 'bold 110px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, s / 2, s / 2);
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.6),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95 }),
    );
    tex.repeat.set(1, 0.25);
    tex.offset.set(0, 0.375);
    mesh.position.set(x, 3.4, z);
    mesh.rotation.y = rotY;
    group.add(mesh);
  };
  sign('SALIDA', 7, 39.7, Math.PI, '#ff2a2a');
  sign('ALMACÉN', 15.5, 6.7, 0, '#ffd27a');
  sign('ALMACÉN', 41.5, 6.7, 0, '#ffd27a');
  sign('FRESCOS', 55, 18, -Math.PI / 2, '#8fe3ff');
  return group;
}

// Estantería de verdad: zócalo, panel central perforado, baldas a los dos lados y postes.
function buildShelf(group, o, { metal, boardMat, postMat }) {
  const alongZ = o.d > o.w;
  const len = alongZ ? o.d : o.w;
  const depth = alongZ ? o.w : o.d;
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    group.add(m);
  };
  // Medidas "a lo largo" (a) y "a lo ancho" (b) pasadas a x/z
  const box = (a, h, b, mat, y, offB = 0, offA = 0) => {
    const geo = new THREE.BoxGeometry(alongZ ? b : a, h, alongZ ? a : b);
    add(geo, mat, o.x + (alongZ ? offB : offA), y, o.z + (alongZ ? offA : offB));
    return geo;
  };
  const back = box(len, o.h, 0.08, metal, o.h / 2);
  scaleUV(back, len / 1.2, o.h / 1.2);
  box(len, 0.1, depth, postMat, 0.05); // zócalo
  for (const y of SHELF_LEVELS) {
    if (y < 0.2) continue;
    box(len, 0.04, depth, boardMat, y - 0.02);
    // Frontal de la balda (donde irían los precios)
    for (const side of [-1, 1]) box(len, 0.06, 0.02, postMat, y - 0.03, side * (depth / 2 - 0.01));
  }
  for (const end of [-1, 1]) {
    box(0.06, o.h, depth, postMat, o.h / 2, 0, end * (len / 2 - 0.03));
  }
}

function scaleUV(geo, u, v) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  uv.needsUpdate = true;
}

// Papel pintado viejo: rayas verticales con un adorno, zócalo de azulejos abajo.
function wallpaperTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#7d8a74';
    g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 32) {
      g.fillStyle = 'rgba(40,50,35,0.35)';
      g.fillRect(x, 0, 10, s);
      g.fillStyle = 'rgba(230,220,180,0.12)';
      g.fillRect(x + 14, 0, 3, s);
    }
    g.fillStyle = 'rgba(60,70,50,0.45)';
    for (let x = 16; x < s; x += 64) {
      for (let y = 20; y < s * 0.7; y += 48) {
        g.beginPath();
        g.ellipse(x + 8, y, 6, 11, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Azulejos blancos y sucios en la parte baja
    const ty = s * 0.74;
    g.fillStyle = '#c9c4b4';
    g.fillRect(0, ty, s, s - ty);
    g.strokeStyle = '#7a766a';
    g.lineWidth = 2;
    for (let x = 0; x <= s; x += 32) g.strokeRect(x, ty, 32, (s - ty) / 2), g.strokeRect(x - 16, ty + (s - ty) / 2, 32, (s - ty) / 2);
    g.fillStyle = '#3d2f25';
    g.fillRect(0, ty - 6, s, 6);
    // Manchas de humedad
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(50,40,20,0.12)';
      g.beginPath();
      g.arc(Math.random() * s, Math.random() * s * 0.7, 10 + Math.random() * 30, 0, Math.PI * 2);
      g.fill();
    }
    dirt(g, s, 500);
  });
}

// Chapa perforada gris de las estanterías.
function pegboardTexture() {
  return canvasTexture(128, (g, s) => {
    g.fillStyle = '#8f959c';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#3c4046';
    for (let x = 8; x < s; x += 16) for (let y = 8; y < s; y += 16) g.fillRect(x - 2, y - 2, 4, 4);
    dirt(g, s, 120);
  });
}

// Puertas de cristal de las cámaras frigoríficas, con productos detrás.
function fridgeTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#1b2a30';
    g.fillRect(0, 0, s, s);
    const cols = ['#d8d8d8', '#2a6fb0', '#e0c040', '#c03030', '#f0f0f0', '#3a9a5a'];
    for (let y = 30; y < s - 20; y += 50) {
      for (let x = 14; x < s - 14; x += 18) {
        g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
        g.fillRect(x, y + 10, 12, 34);
      }
      g.fillStyle = '#9aa4a8';
      g.fillRect(0, y + 44, s, 4);
    }
    g.fillStyle = 'rgba(180,230,255,0.18)';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = '#c8cdd0';
    g.lineWidth = 10;
    g.strokeRect(5, 5, s - 10, s - 10);
    g.fillStyle = '#c8cdd0';
    g.fillRect(s - 30, s * 0.4, 6, s * 0.25); // tirador
  });
}

function crateTexture() {
  return canvasTexture(128, (g, s) => {
    g.fillStyle = '#7a5a36';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = '#4a3420';
    g.lineWidth = 6;
    g.strokeRect(3, 3, s - 6, s - 6);
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(s, s);
    g.stroke();
  });
}

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function dirt(g, s, n) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
    const r = Math.random() * 6;
    g.fillRect(Math.random() * s, Math.random() * s, r, r);
  }
}
