// Modo "La Cena": comedor, mesa, platos de guisantes y el centinela del periódico.
// El servidor decide todo (server/dinner.js); aquí solo se dibuja y se anima.
import * as THREE from 'three';
import { DINNER } from '../shared/constants.js';

// Asientos: dos a cada lado de la mesa, uno enfrente del otro. El centinela, en la cabecera.
const SEATS = [
  { x: -0.55, z: 0.95, face: -1 },
  { x: -0.55, z: -0.95, face: 1 },
  { x: 0.75, z: 0.95, face: -1 },
  { x: 0.75, z: -0.95, face: 1 },
];
const SENTINEL = new THREE.Vector3(-2.75, 0, 0);
const SENTINEL_SCALE = 0.82; // algo más bajo que en el supermercado, pero sigue imponiendo
const TABLE_Y = 0.76;
const EYE_Y = 1.18;

export class DinnerView {
  constructor({ monster, audio, isTouch, toast }) {
    this.monster = monster;
    this.audio = audio;
    this.isTouch = isTouch;
    this.toast = toast;
    this.active = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.02, 30);
    this.scene.add(this.camera);
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
    });
    this.diners = new Map(); // id -> figura en la mesa
    this.state = null; // último estado del servidor
    this.me = null;
    this.look = { yaw: 0, pitch: 0 };
    this.shot = null; // cinemática del disparo en curso
    this.paperY = 0; // altura del periódico respecto a su cabeza
    this.clock = 0;
    this.buildRoom();
    this.buildPlates();
    this.buildPaper();
  }

  // ---- Escenario ----

  buildRoom() {
    const s = this.scene;
    s.background = new THREE.Color(0x050302);
    s.fog = new THREE.Fog(0x050302, 4, 11);
    s.add(new THREE.HemisphereLight(0x806040, 0x100804, 0.12));

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshLambertMaterial({ map: woodTexture() }));
    floor.material.map.repeat.set(6, 6);
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTexture() });
    wallMat.map.repeat.set(4, 1);
    for (const [x, z, r] of [[0, -4, 0], [0, 4, Math.PI], [-4.5, 0, Math.PI / 2], [4.5, 0, -Math.PI / 2]]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.2), wallMat);
      w.position.set(x, 1.6, z);
      w.rotation.y = r;
      s.add(w);
    }

    // Mesa con mantel
    const cloth = new THREE.MeshLambertMaterial({ map: clothTexture() });
    const top = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.06, 1.5), cloth);
    top.position.set(-0.55, TABLE_Y - 0.03, 0);
    s.add(top);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x2a160c });
    for (const x of [-2.5, 1.4]) for (const z of [-0.65, 0.65]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, TABLE_Y, 0.08), legMat);
      leg.position.set(x, TABLE_Y / 2, z);
      s.add(leg);
    }
    // Sillas
    for (const seat of SEATS) {
      const g = new THREE.Group();
      const m = new THREE.MeshLambertMaterial({ color: 0x3a2214 });
      const sit = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.45), m);
      sit.position.y = 0.46;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.05), m);
      back.position.set(0, 0.78, 0.22);
      g.add(sit, back);
      g.position.set(seat.x, 0, seat.z + seat.face * -0.1);
      g.rotation.y = seat.face > 0 ? Math.PI : 0;
      s.add(g);
    }

    // Velas: la única luz del comedor, temblorosa
    this.candles = [];
    for (const x of [-0.9, 0.2, 1.1]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 8), new THREE.MeshLambertMaterial({ color: 0xe8e0c8 }));
      c.position.set(x, TABLE_Y + 0.11, 0);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffc060 }));
      flame.position.set(x, TABLE_Y + 0.25, 0);
      flame.scale.y = 1.8;
      const light = new THREE.PointLight(0xffa040, 1.4, 4.5, 1.6);
      light.position.set(x, TABLE_Y + 0.35, 0);
      s.add(c, flame, light);
      this.candles.push({ light, flame, base: 1.4 });
    }
    // Lámpara sobre el centinela, para que se le vea al bajar el periódico
    this.headLamp = new THREE.SpotLight(0xffd8a0, 6, 6, 0.6, 0.6, 1.5);
    this.headLamp.position.set(SENTINEL.x + 0.6, 3.1, 0);
    this.headLamp.target.position.set(SENTINEL.x, 1.4, 0);
    s.add(this.headLamp, this.headLamp.target);
    // Reloj de pared
    const clock = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), new THREE.MeshBasicMaterial({ map: clockTexture() }));
    clock.position.set(-4.48, 2.4, 0);
    clock.rotation.y = Math.PI / 2;
    s.add(clock);
  }

  buildPlates() {
    this.plates = SEATS.map((seat) => {
      const g = new THREE.Group();
      g.position.set(seat.x, TABLE_Y, seat.z * 0.52);
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.11, 0.02, 24), new THREE.MeshLambertMaterial({ color: 0xf2efe8 }));
      plate.position.y = 0.01;
      g.add(plate);
      const peas = new THREE.InstancedMesh(new THREE.SphereGeometry(0.013, 6, 5), new THREE.MeshLambertMaterial({ color: 0x5fae3a }), DINNER.peas);
      const m = new THREE.Matrix4();
      for (let i = 0; i < DINNER.peas; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.08;
        m.setPosition(Math.cos(a) * r, 0.034 + Math.random() * (0.03 - r * 0.25), Math.sin(a) * r);
        peas.setMatrixAt(i, m);
      }
      g.add(peas);
      this.scene.add(g);
      return { group: g, peas };
    });
  }

  buildPaper() {
    const tex = newspaperTexture();
    this.paper = new THREE.Mesh(
      new THREE.PlaneGeometry(1.05, 0.72),
      new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }),
    );
    this.scene.add(this.paper);
    // Pistola (solo aparece en la cinemática)
    this.gun = new THREE.Group();
    const metal = new THREE.MeshLambertMaterial({ color: 0x1a1a1c });
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.22), metal);
    barrel.position.z = 0.08;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.05), metal);
    grip.position.set(0, -0.07, -0.02);
    grip.rotation.x = 0.3;
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfff0a0 }));
    this.flash.position.z = 0.22;
    this.flash.visible = false;
    this.gun.add(barrel, grip, this.flash);
    this.gun.visible = false;
    this.gun.scale.setScalar(1.8);
    this.scene.add(this.gun);
  }

  // ---- Partida ----

  start(myId, d, info) {
    this.active = true;
    this.me = myId;
    this.shot = null;
    for (const f of this.diners.values()) this.scene.remove(f.group);
    this.diners.clear();
    // El monstruo pasa a este escenario como centinela
    this.monster.root.removeFromParent();
    this.scene.add(this.monster.root);
    this.monster.has = true;
    this.monster.state = 'idle';
    this.monster.playFor('idle', true);
    this.monster.root.position.copy(SENTINEL);
    this.monster.target.copy(SENTINEL);
    this.monster.root.rotation.y = this.monster.targetYaw = Math.PI / 2;
    this.monster.root.scale.setScalar(SENTINEL_SCALE);
    this.monster.root.visible = true;
    this.paper.visible = true;
    this.gun.visible = false;
    this.look.yaw = 0;
    this.look.pitch = 0;
    this.onSnap(d, info);
  }

  stop(mainScene) {
    this.active = false;
    this.monster.root.scale.setScalar(1);
    this.monster.root.removeFromParent();
    mainScene.add(this.monster.root);
    this.monster.hide();
  }

  mine() {
    return this.state?.players.find((p) => p.id === this.me);
  }

  // `info`: id -> { name, color } de los jugadores de la sala
  onSnap(d, info) {
    const prev = this.state;
    this.state = d;
    if (prev && prev.s !== d.s) this.onSentinel(d.s);
    for (const p of d.players) {
      if (p.seat < 0) continue;
      const mine = p.id === this.me;
      let f = this.diners.get(p.id);
      if (!f) {
        f = buildDiner(SEATS[p.seat], info.get(p.id), mine);
        this.scene.add(f.group);
        this.diners.set(p.id, f);
      }
      const before = prev?.players.find((q) => q.id === p.id);
      // Pinchar: el tenedor se clava en el plato y suena. Comer: se oye masticar.
      if (before && p.fork > before.fork) {
        this.audio.clink(mine ? 0.5 : 0.3);
        f.stab = 1;
      }
      if (before && p.eating && !before.eating) this.audio.chew(mine ? 1 : 0.6, p.fork || before.fork);
      f.data = p;
      setForkPeas(f.fork, p.fork);
      this.plates[p.seat].peas.count = Math.max(0, p.peas - p.fork);
    }
    for (const [id, f] of this.diners) {
      if (!d.players.some((p) => p.id === id)) {
        this.scene.remove(f.group);
        this.diners.delete(id);
      }
    }
  }

  onSentinel(s) {
    if (s === 'warning') this.audio.paper(0.9);
    else if (s === 'reading') this.audio.paper(0.3);
  }

  // Disparo: todos ven la escena. Si caen varios a la vez, van todos en el mismo tiro.
  onShot(id) {
    if (this.shot && !this.shot.fired) this.shot.victims.push(id);
    else this.shot = { t: 0, fired: false, victims: [id] };
  }

  aimGun(target) {
    const hand = new THREE.Vector3(SENTINEL.x + 0.5, 1.45, 0);
    this.gun.position.copy(hand);
    this.gun.lookAt(target);
  }

  // ---- Cada frame ----

  update(dt, time) {
    this.clock += dt;
    // Tic-tac
    if (Math.floor(this.clock) !== Math.floor(this.clock - dt)) this.audio.tick(Math.floor(this.clock) % 2 === 0);
    // Velas
    for (const c of this.candles) {
      c.light.intensity = c.base * (0.8 + Math.random() * 0.25);
      c.flame.scale.x = 0.9 + Math.random() * 0.2;
    }

    // Periódico: tapándole la cara leyendo, temblando antes de bajar, abajo mirando.
    // Se coloca respecto a su cabeza, que se mueve con la animación.
    const s = this.shot ? 'watching' : this.state?.s ?? 'reading';
    const head = this.monster.headWorldPosition(new THREE.Vector3());
    const want = s === 'watching' ? -0.85 : s === 'warning' ? -0.1 : 0;
    this.paperY += (want - this.paperY) * Math.min(1, dt * (s === 'watching' ? 9 : 5));
    const shake = s === 'warning' ? Math.sin(time * 40) * 0.015 : 0;
    this.paper.position.set(head.x + 0.32, head.y + this.paperY + shake, head.z);
    this.paper.rotation.set(s === 'watching' ? -1.1 : 0, Math.PI / 2, shake * 3);
    // Mirando: gira la cabeza buscando a alguien (o hacia su víctima)
    let yaw = Math.PI / 2 + (s === 'watching' ? Math.sin(time * 1.3) * 0.35 : 0);
    const victim = this.shot && this.diners.get(this.shot.victims[0]);
    if (victim) {
      const v = victim.group.position;
      yaw = Math.atan2(v.x - SENTINEL.x, v.z - SENTINEL.z);
    }
    this.monster.targetYaw = yaw;
    this.monster.update(dt, time);
    // Sus ojos brillan, pero sin teñir de rojo todo el comedor
    this.monster.faceLight.intensity = s === 'watching' ? 1.5 : 0.4;
    if (s === 'reading' && Math.random() < dt * 0.25) this.audio.paper(0.12);

    // Comensales: clavan el tenedor, se lo llevan a la boca y caen si les disparan
    for (const f of this.diners.values()) {
      const eating = f.data?.eating;
      f.forkT += ((eating ? 1 : 0) - f.forkT) * Math.min(1, dt * 8);
      f.stab = Math.max(0, (f.stab || 0) - dt * 5);
      const jab = Math.sin(f.stab * Math.PI);
      f.fork.position.set(0.16, 0.86 + f.forkT * 0.5 - jab * 0.12, -0.3 + f.forkT * 0.12 - jab * 0.12);
      f.fork.rotation.x = -0.9 + f.forkT * 1.6 - jab * 0.5;
      const fall = f.dead ? 1 : 0;
      f.body.rotation.x += (fall * -1.0 - f.body.rotation.x) * Math.min(1, dt * 6);
      if (f.dead) f.fork.visible = false;
      if (f.data?.place) f.mat.emissive?.setHex(0x113311);
    }

    if (this.shot) {
      this.updateShot(dt);
      return;
    }

    // Tercera persona: desde el otro extremo de la mesa, de frente al centinela.
    // Arrastrando se gira un poco alrededor de la mesa.
    this.placeCamera(this.look.yaw, this.look.pitch, 0);
  }

  placeCamera(yaw, pitch, zoom) {
    const target = new THREE.Vector3(-1.1, 1.0, 0);
    const dist = 4.4 - zoom * 1.6;
    const a = Math.PI / 2 + yaw; // 0 = detrás del extremo de la mesa, mirando a la cabecera
    this.camera.position.set(
      target.x + Math.sin(a) * dist * Math.cos(0.3 + pitch),
      target.y + Math.sin(0.3 + pitch) * dist + 0.4,
      target.z + Math.cos(a) * dist * Math.cos(0.3 + pitch),
    );
    this.camera.lookAt(target);
  }

  // Cinemática para todos: baja el periódico, saca la pistola, apunta, disparo y
  // la víctima cae sobre la mesa. A quien disparan, además, se le pone la pantalla roja.
  updateShot(dt) {
    const sh = this.shot;
    sh.t += dt * 1000;
    const p = sh.t / DINNER.shotMs;
    const victims = sh.victims.map((id) => this.diners.get(id)).filter(Boolean);
    const target = victims[0] ? victims[0].head.getWorldPosition(new THREE.Vector3()) : this.camera.position;
    const iAmHit = sh.victims.includes(this.me);
    const el = document.getElementById('scare');
    // La cámara se acerca un poco a la escena
    this.placeCamera(this.look.yaw * (1 - Math.min(1, p * 3)), 0, Math.min(1, p * 3) * 0.6);
    this.gun.visible = true;
    this.aimGun(target);
    if (p < 0.4) {
      // La pistola sube despacio hacia la víctima
      this.gun.position.y -= (1 - p / 0.4) * 0.4;
    } else if (!sh.fired) {
      sh.fired = true;
      this.audio.gunshot(iAmHit ? 1.2 : 0.9);
      this.flash.visible = true;
      for (const f of victims) f.dead = true;
      el.classList.remove('hidden');
      el.style.background = iAmHit ? 'rgba(255,255,255,0.95)' : 'rgba(255,240,200,0.5)';
    } else {
      this.flash.visible = sh.t - DINNER.shotMs * 0.4 < 80;
      const q = Math.min(1, (p - 0.4) / 0.3);
      el.style.background = iAmHit ? `rgba(${160 - q * 100},0,0,${0.6 - q * 0.25})` : `rgba(255,240,200,${Math.max(0, 0.5 - q)})`;
    }
    if (sh.t >= DINNER.shotMs) {
      el.classList.add('hidden');
      el.style.background = '';
      this.gun.visible = false;
      this.flash.visible = false;
      this.shot = null;
      if (iAmHit) this.toast('Te han pillado. Mira cómo siguen los demás...', 3500);
    }
  }

  drag(dx, dy) {
    this.look.yaw = THREE.MathUtils.clamp(this.look.yaw - dx * 0.004, -0.9, 0.9);
    this.look.pitch = THREE.MathUtils.clamp(this.look.pitch + dy * 0.003, -0.2, 0.5);
  }
}

// ---- Piezas ----

function buildFork() {
  const g = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ color: 0xc8ccd2 });
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.17), m);
  handle.position.z = 0.09;
  g.add(handle);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.005, 0.02), m);
  g.add(neck);
  for (let i = 0; i < 4; i++) {
    const tine = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.06), m);
    tine.position.set(-0.012 + i * 0.008, 0, -0.04);
    g.add(tine);
  }
  const peas = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0075, 6, 5), new THREE.MeshLambertMaterial({ color: 0x6fc046 }), DINNER.peas);
  peas.count = 0;
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < DINNER.peas; i++) {
    // Se apilan en montoncito sobre las púas
    const layer = Math.floor(i / 8), k = i % 8;
    mtx.setPosition(((k % 4) - 1.5) * 0.008, 0.007 + layer * 0.011, -0.03 - Math.floor(k / 4) * 0.014 + layer * 0.002);
    peas.setMatrixAt(i, mtx);
  }
  g.add(peas);
  g.userData.peas = peas;
  return g;
}

function setForkPeas(fork, n) {
  fork.userData.peas.count = Math.min(n, 32); // el montón no crece más allá de esto
}

function buildDiner(seat, info = {}, isMe = false) {
  const group = new THREE.Group();
  group.position.set(seat.x, 0, seat.z);
  group.rotation.y = seat.face < 0 ? 0 : Math.PI;
  const mat = new THREE.MeshLambertMaterial({ color: info.color ?? 0x888888 });
  const body = new THREE.Group();
  body.position.y = 0.5;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 4, 8), mat);
  torso.position.y = 0.35;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), mat);
  head.position.y = 0.82;
  body.add(torso, head);
  group.add(body);
  const fork = buildFork();
  fork.scale.setScalar(1.6);
  group.add(fork);
  // Nombre encima
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillStyle = isMe ? 'rgba(255,230,120,0.95)' : 'rgba(255,255,255,0.85)';
  g.fillText(isMe ? `TÚ · ${info.name ?? ''}` : info.name ?? '', 128, 44);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  label.scale.set(0.8, 0.2, 1);
  label.position.y = 1.65;
  group.add(label);
  return { group, body, head, mat, fork, forkT: 0, dead: false, data: null };
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

function woodTexture() {
  return canvasTexture(128, (g, s) => {
    g.fillStyle = '#3a2416';
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) {
      g.fillStyle = `rgba(0,0,0,${0.2 + Math.random() * 0.2})`;
      g.fillRect(0, y, s, 2);
      g.fillStyle = `rgba(120,70,40,${Math.random() * 0.2})`;
      g.fillRect(0, y + 3, s, 10);
    }
  });
}

function wallTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#3b1414';
    g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(90,40,30,0.5)';
    for (let x = 0; x < s; x += 32) {
      for (let y = 0; y < s * 0.7; y += 40) {
        g.beginPath();
        g.ellipse(x + 16 + ((y / 40) % 2) * 16, y + 20, 7, 12, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = '#24140c';
    g.fillRect(0, s * 0.72, s, s * 0.28);
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.2})`;
      g.fillRect(Math.random() * s, Math.random() * s, 3, 3);
    }
  });
}

function clothTexture() {
  return canvasTexture(128, (g, s) => {
    g.fillStyle = '#d8d2c2';
    g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(150,20,20,0.35)';
    for (let i = 0; i < s; i += 16) {
      g.fillRect(i, 0, 6, s);
      g.fillRect(0, i, s, 6);
    }
    // Alguna mancha de vino
    g.fillStyle = 'rgba(90,0,10,0.35)';
    g.beginPath();
    g.arc(s * 0.7, s * 0.3, 10, 0, Math.PI * 2);
    g.fill();
  });
}

function newspaperTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#d9d2bf';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#1a1a1a';
    g.font = 'bold 30px serif';
    g.textAlign = 'center';
    g.fillText('EL VIGÍA', s / 2, 34);
    g.font = 'bold 15px serif';
    g.fillText('DESAPARECEN 4 COMENSALES', s / 2, 62);
    g.fillRect(14, 40, s - 28, 2);
    g.fillStyle = '#555';
    g.fillRect(18, 76, 100, 70);
    for (let y = 80; y < s - 10; y += 8) {
      const x0 = y < 150 ? 128 : 18;
      g.fillStyle = 'rgba(30,30,30,0.6)';
      g.fillRect(x0, y, s - 18 - x0 - Math.random() * 30, 3);
    }
  });
}

function clockTexture() {
  return canvasTexture(128, (g, s) => {
    g.fillStyle = '#e8dcc0';
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#222';
    g.lineWidth = 4;
    g.stroke();
    g.beginPath();
    g.moveTo(s / 2, s / 2);
    g.lineTo(s / 2, 20);
    g.moveTo(s / 2, s / 2);
    g.lineTo(s * 0.78, s / 2);
    g.stroke();
  });
}
