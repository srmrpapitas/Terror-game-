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
    this.blood = new Blood(this.scene);
  }

  // ---- Partida ----

  start(myId, d, info) {
    this.active = true;
    this.me = myId;
    this.shot = null;
    this.blood.clear();
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

    // Comensales: el cuerpo quieto; solo el brazo del tenedor pincha, sube a la boca
    // y mastican. Si les disparan, se desploman sobre la mesa.
    for (const f of this.diners.values()) {
      const eating = f.data?.eating;
      f.forkT += ((eating ? 1 : 0) - f.forkT) * Math.min(1, dt * 7);
      f.stab = Math.max(0, (f.stab || 0) - dt * 5);
      const jab = Math.sin(f.stab * Math.PI);
      const t = f.forkT;
      f.arm.rotation.set(ARM_REST.x + (ARM_EAT.x - ARM_REST.x) * t - jab * 0.3, 0, ARM_REST.z + (ARM_EAT.z - ARM_REST.z) * t);
      // Boca: se abre al acercar el tenedor y mastica mientras come
      const chew = eating && t > 0.7 ? 0.5 + 0.5 * Math.sin(time * 18 + f.phase) : t * 0.3;
      f.mouth.scale.y = 0.4 + chew * 1.6;
      f.jaw.position.y = -0.085 - chew * 0.012;
      const fall = f.dead ? 1 : 0;
      f.upper.rotation.x += (fall * -1.05 - f.upper.rotation.x) * Math.min(1, dt * 6);
      if (f.dead) {
        f.fork.visible = false;
        f.mouth.scale.y = 1.2;
      }
      if (f.data?.place) f.shirt.emissive?.setHex(0x113311);
    }

    this.blood.update(dt);
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
    const v = victims[0];
    const head = v ? v.head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(-0.55, 1.3, 0);
    if (!sh.from) sh.from = head.clone(); // dónde estaba la cabeza antes de caer
    const iAmHit = sh.victims.includes(this.me);
    const el = document.getElementById('scare');
    const FIRE = 0.3;
    document.getElementById('cine').classList.toggle('on', p < 0.93);
    document.getElementById('dinner-ui').classList.toggle('cine', p < 0.97);

    // Plano de cine: de frente a la víctima, con el centinela y la pistola de lado
    const toS = new THREE.Vector3(SENTINEL.x - sh.from.x, 0, SENTINEL.z - sh.from.z).normalize();
    const toCenter = new THREE.Vector3(0, 0, -Math.sign(sh.from.z || 1));
    const close = sh.from.clone().addScaledVector(toCenter, 0.8).addScaledVector(toS, 1.15);
    close.y = sh.from.y + 0.45;
    const ease = (x) => x * x * (3 - 2 * x);
    // Antes del disparo: por encima del hombro del centinela, la pistola apuntando
    const gunHand = new THREE.Vector3(SENTINEL.x + 0.5, 1.45, 0);
    const aim = sh.from.clone().sub(gunHand).normalize();
    const shoulder = gunHand.clone().addScaledVector(aim, -0.85);
    shoulder.y += 0.5;
    shoulder.z -= Math.sign(sh.from.z || 1) * 0.35;
    let blend, zoom, pos, look;
    if (p < FIRE) {
      blend = ease(Math.min(1, p / 0.15));
      zoom = ease(Math.min(1, p / FIRE)) * 0.6;
      pos = shoulder;
      look = sh.from;
    } else if (p < 0.78) {
      blend = 1;
      zoom = ease(Math.min(1, (p - FIRE) / 0.4)); // tras el disparo, zoom lento sobre la víctima
      pos = close;
      look = head.clone().lerp(sh.from, 0.5);
    } else {
      blend = 1 - ease((p - 0.78) / 0.22);
      zoom = blend;
      pos = close;
      look = head.clone().lerp(sh.from, 0.5);
    }
    this.placeCamera(this.look.yaw * (1 - blend), this.look.pitch * (1 - blend), 0);
    const over = this.camera.position.clone();
    this.camera.position.lerpVectors(over, pos, blend);
    const lookOver = new THREE.Vector3(-1.1, 1.0, 0);
    this.camera.lookAt(lookOver.lerp(look, blend));
    this.camera.fov = 70 - zoom * 18;
    // Temblor del disparo
    const since = sh.t - DINNER.shotMs * FIRE;
    if (since > 0 && since < 350) {
      const k = (1 - since / 350) * 0.05;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
    }
    this.camera.updateProjectionMatrix();

    this.gun.visible = true;
    this.aimGun(sh.from);
    if (p < FIRE) {
      // La pistola sube despacio hacia la víctima
      this.gun.position.y -= (1 - p / FIRE) * 0.4;
    } else if (!sh.fired) {
      sh.fired = true;
      this.audio.gunshot(iAmHit ? 1.2 : 0.9);
      this.flash.visible = true;
      for (const f of victims) {
        f.dead = true;
        const h = f.head.getWorldPosition(new THREE.Vector3());
        const dir = h.clone().sub(this.gun.position).normalize();
        this.blood.burst(h, dir);
        this.blood.splatAround(f.group.position, f.group.rotation.y);
      }
      el.classList.remove('hidden');
      el.style.background = iAmHit ? 'rgba(255,255,255,0.95)' : 'rgba(255,240,200,0.5)';
    } else {
      this.flash.visible = since < 80;
      const q = Math.min(1, (p - FIRE) / 0.3);
      el.style.background = iAmHit ? `rgba(${160 - q * 100},0,0,${0.6 - q * 0.3})` : `rgba(255,240,200,${Math.max(0, 0.5 - q * 2)})`;
    }
    if (sh.t >= DINNER.shotMs) {
      el.classList.add('hidden');
      el.style.background = '';
      document.getElementById('cine').classList.remove('on');
      document.getElementById('dinner-ui').classList.remove('cine');
      this.camera.fov = 70;
      this.camera.updateProjectionMatrix();
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

// Mancha de sangre hecha de cuadraditos, como un charco pixelado
function pixelBlob(mat) {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(0.2, 0.2);
  for (let x = -2; x <= 2; x++) {
    for (let y = -2; y <= 2; y++) {
      const d = Math.hypot(x, y);
      if (d > 2.4 || (d > 1.4 && Math.random() < 0.5)) continue;
      const q = new THREE.Mesh(geo, mat);
      q.position.set(x * 0.2, y * 0.2, 0);
      g.add(q);
    }
  }
  return g;
}

// Sangre pixelada: gotas cúbicas que salen de la cabeza y se quedan en la mesa,
// y manchas que crecen sobre el mantel y el plato.
class Blood {
  constructor(scene) {
    this.scene = scene;
    this.max = 160;
    this.drops = new THREE.InstancedMesh(new THREE.BoxGeometry(0.022, 0.022, 0.022), new THREE.MeshLambertMaterial({ color: 0x8a0a0a }), this.max);
    this.drops.count = 0;
    this.drops.frustumCulled = false;
    scene.add(this.drops);
    this.parts = [];
    this.splats = [];
    this.splatMat = new THREE.MeshLambertMaterial({ color: 0x6e0606, polygonOffset: true, polygonOffsetFactor: -2 });
    this.m = new THREE.Matrix4();
  }

  clear() {
    this.parts = [];
    this.drops.count = 0;
    for (const s of this.splats) this.scene.remove(s.mesh);
    this.splats = [];
  }

  burst(at, dir) {
    for (let i = 0; i < 70 && this.parts.length < this.max; i++) {
      const sp = 1.2 + Math.random() * 2.6;
      this.parts.push({
        p: at.clone(),
        v: new THREE.Vector3(dir.x * sp + (Math.random() - 0.5) * 1.6, 0.6 + Math.random() * 1.8, dir.z * sp + (Math.random() - 0.5) * 1.6),
        s: 0.5 + Math.random() * 1.1,
        rest: false,
      });
    }
  }

  // Charcos sobre la mesa delante de la víctima y salpicaduras en su comida
  splatAround(pos, yaw) {
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)); // hacia la mesa
    const spots = [[0.85, 0, 0.5], [0.7, 0.32, 0.3], [0.78, -0.34, 0.32], [0.45, 0.3, 0.2], [1.0, 0.2, 0.22], [0.5, -0.3, 0.18], [0.95, -0.25, 0.2]];
    for (const [ahead, side, size] of spots) {
      const mesh = pixelBlob(this.splatMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.random() * Math.PI;
      const x = pos.x + fwd.x * ahead + fwd.z * side, z = pos.z + fwd.z * ahead - fwd.x * side;
      mesh.position.set(x, TABLE_Y + 0.004, z);
      mesh.scale.setScalar(0.001);
      this.scene.add(mesh);
      this.splats.push({ mesh, size: size * 0.7 * (0.8 + Math.random() * 0.4), t: -Math.random() * 0.25 });
    }
  }

  update(dt) {
    for (const s of this.splats) {
      if (s.t >= 1) continue;
      s.t += dt * 2.5;
      s.mesh.scale.setScalar(Math.max(0.001, Math.min(1, s.t) * s.size));
    }
    let n = 0;
    for (const q of this.parts) {
      if (!q.rest) {
        q.v.y -= 9.8 * dt;
        q.p.addScaledVector(q.v, dt);
        const onTable = Math.abs(q.p.x + 0.55) < 2.1 && Math.abs(q.p.z) < 0.75;
        const floor = onTable ? TABLE_Y + 0.012 : 0.01;
        if (q.p.y <= floor && (onTable || q.p.y < 0.2)) {
          q.p.y = floor;
          q.rest = true;
        }
      }
      this.m.makeScale(q.s, q.rest ? 0.25 : q.s, q.s).setPosition(q.p);
      this.drops.setMatrixAt(n++, this.m);
    }
    this.drops.count = n;
    this.drops.instanceMatrix.needsUpdate = true;
  }
}


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

// Brazo derecho: en reposo apunta al plato; comiendo, lleva el tenedor a la boca
const ARM_REST = { x: 0.95, z: 0 };
const ARM_EAT = { x: 2.35, z: -0.62 };
const SKINS = [0xe8b896, 0xc68a5e, 0xf1cfb0, 0x8d5a3b];
const HAIRS = [0x3a2414, 0x111111, 0xd9a443, 0x6b3a1f];

// Comensal de bloques, estilo Minecraft: cabeza cúbica con cara pixelada
function buildDiner(seat, info = {}, isMe = false) {
  const n = Math.max(0, SEATS.indexOf(seat));
  const group = new THREE.Group();
  group.position.set(seat.x, 0, seat.z);
  group.rotation.y = seat.face < 0 ? 0 : Math.PI;
  const shirt = new THREE.MeshLambertMaterial({ color: info.color ?? 0x888888 });
  const skin = new THREE.MeshLambertMaterial({ color: SKINS[n] });
  const hair = new THREE.MeshLambertMaterial({ color: HAIRS[n] });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2b3448 });
  const box = (w, h, d, mat, x, y, z, parent) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  // Piernas sentadas (casi todo queda bajo la mesa)
  for (const sx of [-0.1, 0.1]) {
    box(0.15, 0.14, 0.42, pants, sx, 0.52, -0.14, group);
    box(0.14, 0.45, 0.14, pants, sx, 0.25, -0.3, group);
  }
  // Tronco, cabeza y brazos giran juntos desde la cadera si le disparan
  const upper = new THREE.Group();
  upper.position.y = 0.6;
  group.add(upper);
  box(0.42, 0.5, 0.24, shirt, 0, 0.27, 0, upper);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), [hair, hair, hair, skin, hair, faceMaterial(SKINS[n], HAIRS[n], n)]);
  head.position.y = 0.7;
  upper.add(head);
  // Boca que se abre y mastica, y mandíbula para que se note
  const mouth = box(0.1, 0.03, 0.01, new THREE.MeshBasicMaterial({ color: 0x3a0d0d }), 0, -0.07, -0.162, head);
  const jaw = box(0.2, 0.04, 0.02, skin, 0, -0.085, -0.155, head);
  jaw.visible = false;
  // Brazo izquierdo apoyado; el derecho sostiene el tenedor
  const left = new THREE.Group();
  left.position.set(-0.27, 0.47, 0);
  left.rotation.x = 1.2;
  upper.add(left);
  box(0.12, 0.42, 0.12, shirt, 0, -0.17, 0, left);
  box(0.11, 0.08, 0.11, skin, 0, -0.41, 0, left);
  const arm = new THREE.Group();
  arm.position.set(0.27, 0.47, 0);
  upper.add(arm);
  box(0.12, 0.42, 0.12, shirt, 0, -0.17, 0, arm);
  box(0.11, 0.08, 0.11, skin, 0, -0.41, 0, arm);
  const fork = buildFork();
  fork.scale.setScalar(1.6);
  fork.position.set(0, -0.44, -0.04);
  fork.rotation.x = -Math.PI / 2 + 0.5;
  arm.add(fork);
  // Nombre encima
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.fillStyle = isMe ? 'rgba(255,230,120,0.95)' : 'rgba(255,255,255,0.85)';
  g.fillText(isMe ? `TÚ · ${info.name ?? ''}` : info.name ?? '', 128, 44);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  label.scale.set(0.8, 0.2, 1);
  label.position.y = 1.72;
  group.add(label);
  return { group, upper, head, arm, mouth, jaw, shirt, fork, forkT: 0, phase: n * 1.7, dead: false, data: null };
}

// Cara pixelada de 16x16: pelo, cejas, ojos con pupila y mejillas
function faceMaterial(skinHex, hairHex, n) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  const hex = (h) => '#' + h.toString(16).padStart(6, '0');
  g.fillStyle = hex(skinHex);
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = hex(hairHex);
  g.fillRect(0, 0, 16, 4);
  g.fillRect(0, 4, 2, 3 + (n % 2) * 3);
  g.fillRect(14, 4, 2, 3 + (n % 2) * 3);
  if (n === 2) g.fillRect(2, 4, 5, 1); // flequillo
  // Cejas
  g.fillRect(3, 6, 3, 1);
  g.fillRect(10, 6, 3, 1);
  // Ojos: blanco y pupila (miran un poco hacia el centinela)
  g.fillStyle = '#ffffff';
  g.fillRect(3, 7, 3, 2);
  g.fillRect(10, 7, 3, 2);
  g.fillStyle = n === 1 ? '#3b7a3b' : '#2b4d8c';
  g.fillRect(3, 7, 2, 2);
  g.fillRect(10, 7, 2, 2);
  g.fillStyle = '#111111';
  g.fillRect(3, 8, 1, 1);
  g.fillRect(10, 8, 1, 1);
  // Nariz y mejillas
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(7, 9, 2, 2);
  g.fillStyle = 'rgba(220,80,80,0.3)';
  g.fillRect(2, 10, 2, 1);
  g.fillRect(12, 10, 2, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshLambertMaterial({ map: tex });
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
