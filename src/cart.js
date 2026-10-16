// Carrito de la compra: lo empuja cada jugador y en él se ven los productos que ha cogido.
import * as THREE from 'three';

const metal = new THREE.MeshLambertMaterial({ color: 0xa7adb3 });
const dark = new THREE.MeshLambertMaterial({ color: 0x222222 });
const red = new THREE.MeshLambertMaterial({ color: 0xb02a20 });

// El carrito mira hacia +z: el asa queda en z = 0 y la cesta delante.
export function buildCart() {
  const g = new THREE.Group();
  const bar = (w, h, d, x, y, z, mat = metal) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  const W = 0.55, L = 0.8, z0 = 0.15, y0 = 0.45, H = 0.45;
  // Cesta de rejilla: fondo, laterales con barrotes y bordes
  bar(W, 0.02, L, 0, y0, z0 + L / 2);
  for (const x of [-W / 2, W / 2]) {
    bar(0.02, 0.02, L, x, y0 + H, z0 + L / 2);
    for (let z = z0; z <= z0 + L + 0.01; z += 0.1) bar(0.012, H, 0.012, x, y0 + H / 2, z);
  }
  for (const z of [z0, z0 + L]) {
    bar(W, 0.02, 0.02, 0, y0 + H, z);
    for (let x = -W / 2; x <= W / 2 + 0.01; x += 0.09) bar(0.012, H, 0.012, x, y0 + H / 2, z);
  }
  // Chasis y ruedas
  for (const x of [-W / 2 + 0.04, W / 2 - 0.04]) {
    bar(0.03, 0.03, L + 0.05, x, 0.12, z0 + L / 2);
    bar(0.03, y0 - 0.12, 0.03, x, (y0 + 0.12) / 2, z0 + 0.02);
    bar(0.03, y0 - 0.12, 0.03, x, (y0 + 0.12) / 2, z0 + L - 0.02);
    for (const z of [z0 + 0.03, z0 + L - 0.03]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.06, z);
      g.add(wheel);
    }
  }
  // Asa roja
  bar(0.03, 0.25, 0.03, -W / 2, y0 + H + 0.1, z0 - 0.05);
  bar(0.03, 0.25, 0.03, W / 2, y0 + H + 0.1, z0 - 0.05);
  bar(W + 0.06, 0.04, 0.04, 0, y0 + H + 0.22, z0 - 0.08, red);

  const contents = new THREE.Group();
  contents.position.set(0, y0 + 0.01, z0 + L / 2);
  g.add(contents);
  g.userData.contents = contents;
  return g;
}

// Mete un producto (una caja del color del producto) en la cesta.
export function addToCart(cart, color) {
  const contents = cart.userData.contents;
  const n = contents.children.length;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.22, 0.16),
    new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.15 }),
  );
  box.position.set(((n % 2) - 0.5) * 0.24, 0.11 + Math.floor(n / 6) * 0.22, (Math.floor(n / 2) % 3 - 1) * 0.24);
  box.rotation.y = (Math.random() - 0.5) * 0.6;
  contents.add(box);
}

export function emptyCart(cart) {
  cart.userData.contents.clear();
}
