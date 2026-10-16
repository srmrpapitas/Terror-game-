// Construye el supermercado en Three.js a partir de shared/map.js.
import * as THREE from 'three';
import { WIDTH, DEPTH, CEILING, OBSTACLES, EXIT_ZONE } from '../shared/map.js';

const FOG_COLOR = 0x030405;

export function buildWorld(scene, { lowQuality }) {
  scene.background = new THREE.Color(FOG_COLOR);
  // Niebla: densa a partir de ~15 m y opaca hacia los 28 m (ver documento de diseño)
  scene.fog = new THREE.Fog(FOG_COLOR, lowQuality ? 4 : 6, lowQuality ? 22 : 28);

  scene.add(new THREE.HemisphereLight(0x8090a0, 0x201810, 0.35));

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

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH, DEPTH),
    new THREE.MeshLambertMaterial({ color: 0x2a2a2a }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(WIDTH / 2, CEILING, DEPTH / 2);
  scene.add(ceiling);

  // Obstáculos
  const wallTex = canvasTexture(256, (g, s) => {
    g.fillStyle = '#8c8676';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#5c3a2a';
    g.fillRect(0, s * 0.82, s, s * 0.18);
    dirt(g, s, 400);
  });
  const mats = {
    wall: new THREE.MeshLambertMaterial({ map: wallTex }),
    shelf: new THREE.MeshLambertMaterial({ color: 0x9a9fa6 }),
    fridge: new THREE.MeshLambertMaterial({ color: 0xc9d6dc, emissive: 0x0b2a33 }),
    crate: new THREE.MeshLambertMaterial({ map: crateTexture() }),
    checkout: new THREE.MeshLambertMaterial({ color: 0x3a3f46 }),
    promo: new THREE.MeshLambertMaterial({ color: 0xb0281e }),
  };
  const productSlots = [];
  for (const o of OBSTACLES) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), mats[o.kind] || mats.shelf);
    mesh.position.set(o.x, o.h / 2, o.z);
    scene.add(mesh);
    if (o.kind === 'shelf' || o.kind === 'promo') productSlots.push(o);
  }
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
  const panelOn = new THREE.MeshBasicMaterial({ color: 0xe8f0ff });
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
      light = new THREE.PointLight(0xdfe8ff, 14, 13, 1.6);
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
    const levels = o.kind === 'promo' ? [o.h] : [0.35, 0.95, 1.55, 2.15];
    for (const y of levels) {
      for (let t = 0.25; t < len - 0.2; t += 0.32 + Math.random() * 0.12) {
        if (Math.random() < 0.18) continue; // huecos vacíos
        for (const side of o.kind === 'promo' ? [0] : [-1, 1]) {
          const h = 0.2 + Math.random() * 0.3;
          const off = side * (alongZ ? o.w : o.d) * 0.32;
          const x = alongZ ? o.x + off : o.x - o.w / 2 + t;
          const z = alongZ ? o.z - o.d / 2 + t : o.z + off;
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
