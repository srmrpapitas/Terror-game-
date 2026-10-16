import * as THREE from 'three';
import { buildWorld } from './world.js';
import { MonsterView } from './monster.js';
import { LocalPlayer } from './player.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { SPAWN, inExitZone } from '../shared/map.js';
import { PLAYER, JUMPSCARE_MS, TICK_RATE } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.toggle('touch', isTouch);

// ---- Render ----
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, isTouch ? 24 : 30);
scene.add(camera);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const world = buildWorld(scene, { lowQuality: isTouch });
const monster = new MonsterView(scene);
const player = new LocalPlayer(camera, canvas, isTouch);
const audio = new Audio();

// El anfitrión no puede empezar hasta tener el monstruo cargado (el FBX pesa ~12 MB)
$('loading').classList.remove('hidden');
$('btn-start').disabled = true;
$('btn-start').textContent = 'Cargando al monstruo...';
monster.load('/models/warrok.fbx', () => {
  $('loading').classList.add('hidden');
  $('btn-start').disabled = false;
  $('btn-start').textContent = 'Empezar';
});

if (isTouch) {
  player.bindTouch({
    stick: $('stick'), knob: $('stick-knob'), lookZone: $('look-zone'),
    runBtn: $('t-run'), crouchBtn: $('t-crouch'), lightBtn: $('t-light'), useBtn: $('t-use'),
  });
}

// ---- Estado de la partida ----
let net = null;
let myId = null;
let hostId = null;
let roomCode = null;
let phase = 'menu'; // menu | lobby | playing | ended
let items = new Map(); // id -> { data, mesh }
const remotes = new Map(); // id -> vista de otro jugador
let scare = null; // susto en curso
let monsterTarget = null;
let nearestItem = null;

// ---- Menú ----
const params = new URLSearchParams(location.search);
$('name').value = localStorage.getItem('uc-name') || '';
if (params.get('sala')) $('code').value = params.get('sala').toUpperCase();

$('btn-create').onclick = () => connect({ t: 'create' });
$('btn-join').onclick = () => {
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) return showMenuError('El código tiene 4 letras.');
  connect({ t: 'join', code });
};
$('btn-start').onclick = () => {
  audio.unlock();
  goFullscreen();
  net.send({ t: 'start' });
};
$('btn-again').onclick = () => net.send({ t: 'start' });
$('btn-share').onclick = async () => {
  const url = `${location.origin}${location.pathname}?sala=${roomCode}`;
  try {
    if (navigator.share && isTouch) await navigator.share({ title: 'Última Compra', url });
    else await navigator.clipboard.writeText(url);
    $('btn-share').textContent = 'Enlace copiado';
  } catch {
    $('btn-share').textContent = url;
  }
};

function showMenuError(msg) {
  $('menu-error').textContent = msg;
}

async function connect(first) {
  audio.unlock();
  const name = $('name').value.trim() || 'Jugador';
  try { localStorage.setItem('uc-name', name); } catch { /* sin almacenamiento */ }
  net?.ws.close();
  net = new Net(onMessage, () => {
    if (phase !== 'menu') {
      toast('Se perdió la conexión con el servidor');
      setTimeout(() => location.reload(), 2500);
    }
  }, first.code);
  try {
    await net.open;
  } catch {
    return showMenuError('No se pudo conectar con el servidor.');
  }
  net.send({ ...first, name });
}

function goFullscreen() {
  if (!isTouch) return;
  document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
}

// ---- Mensajes del servidor ----
function onMessage(msg) {
  switch (msg.t) {
    case 'error':
      showMenuError(msg.msg);
      break;
    case 'joined':
      myId = msg.id;
      roomCode = msg.code;
      phase = 'lobby';
      $('menu-main').classList.add('hidden');
      $('menu-lobby').classList.remove('hidden');
      $('lobby-code').textContent = msg.code;
      $('room-tag').textContent = `Sala ${msg.code}`;
      history.replaceState(null, '', `?sala=${msg.code}`);
      break;
    case 'lobby': {
      hostId = msg.host;
      const ul = $('lobby-players');
      ul.innerHTML = '';
      for (const p of msg.players) {
        const li = document.createElement('li');
        li.textContent = p.name + (p.id === msg.host ? ' (anfitrión)' : '') + (p.id === myId ? ' · tú' : '');
        li.style.borderColor = '#' + p.color.toString(16).padStart(6, '0');
        ul.appendChild(li);
      }
      const amHost = hostId === myId;
      $('btn-start').classList.toggle('hidden', !amHost);
      $('lobby-wait').classList.toggle('hidden', amHost);
      $('btn-again').classList.toggle('hidden', !amHost);
      $('end-wait').classList.toggle('hidden', amHost);
      for (const id of remotes.keys()) {
        if (!msg.players.some((p) => p.id === id)) removeRemote(id);
      }
      break;
    }
    case 'round':
      startRound(msg);
      break;
    case 'snap':
      onSnapshot(msg);
      break;
    case 'taken': {
      const it = items.get(msg.id);
      if (it) {
        it.data.takenBy = msg.by;
        scene.remove(it.mesh);
      }
      if (msg.by === myId) audio.pickup();
      toast(`${msg.by === myId ? 'Has cogido' : msg.name + ' ha cogido'}: ${it?.data.name ?? ''}`);
      renderList();
      break;
    }
    case 'roar':
      audio.roar(monster.root.position.x, monster.root.position.z);
      if (msg.target === myId) toast('¡TE HA VISTO! ¡CORRE!', 1500);
      break;
    case 'caught':
      if (msg.id === myId) startScare(msg.m);
      else {
        const r = remotes.get(msg.id);
        if (r) audio.distantScream(r.group.position.x, r.group.position.z);
        toast(`${msg.name} ha sido atrapado`);
      }
      break;
    case 'end':
      endRound(msg.result);
      break;
  }
}

function startRound(msg) {
  phase = 'playing';
  for (const it of items.values()) scene.remove(it.mesh);
  items = new Map();
  for (const d of msg.items) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.32, 0.28),
      new THREE.MeshLambertMaterial({ color: d.color, emissive: d.color, emissiveIntensity: 0.4 }),
    );
    mesh.position.set(d.x, d.y, d.z);
    if (!d.takenBy) scene.add(mesh);
    items.set(d.id, { data: d, mesh });
  }
  renderList();

  const idx = [...remotes.keys(), myId].sort().indexOf(myId);
  player.pos.set(SPAWN.x - 2 + idx * 1.3, 0, SPAWN.z);
  player.yaw = 0;
  player.pitch = 0;
  player.alive = true;
  player.stamina = 1;
  player.frozen = false;
  scare = null;
  monster.hide();
  $('menu').classList.add('hidden');
  $('end').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('touch').classList.toggle('hidden', !isTouch);
  updateClickToPlay();
  toast('Coged todo lo de la lista y salid por las cajas. No hagáis ruido.', 4000);
}

function endRound(result) {
  phase = 'ended';
  player.frozen = true;
  document.exitPointerLock?.();
  $('touch').classList.add('hidden');
  $('end').classList.remove('hidden');
  $('end-title').textContent = result === 'win' ? 'HABÉIS ESCAPADO' : 'NADIE SALIÓ';
  $('end-text').textContent = result === 'win'
    ? 'La compra está hecha. Por esta noche.'
    : 'El supermercado tiene nuevos empleados.';
}

function renderList() {
  const ul = $('list-items');
  ul.innerHTML = '';
  let done = 0;
  for (const { data } of items.values()) {
    const li = document.createElement('li');
    li.textContent = data.name;
    if (data.takenBy) { li.classList.add('done'); done++; }
    ul.appendChild(li);
  }
  if (items.size && done === items.size) {
    const li = document.createElement('li');
    li.className = 'exit';
    li.textContent = '¡Lista completa! Id a la SALIDA junto a las cajas';
    ul.appendChild(li);
  }
}

// ---- Otros jugadores ----
function onSnapshot(msg) {
  const seen = new Set();
  for (const p of msg.players) {
    if (p.id === myId) {
      // El servidor manda: si dice que estás fuera de juego, eres fantasma
      if (!p.alive && player.alive && !scare && phase === 'playing') becomeGhost();
      continue;
    }
    seen.add(p.id);
    let r = remotes.get(p.id);
    if (!r) r = addRemote(p);
    r.target.set(p.p[0], 0, p.p[2]);
    r.yaw = p.yaw;
    r.crouch = p.crouch;
    r.alive = p.alive;
    r.lightOn = p.light;
  }
  for (const id of remotes.keys()) if (!seen.has(id)) removeRemote(id);

  if (msg.m && phase === 'playing') {
    monsterTarget = msg.m.target;
    if (!scare) monster.setNet(msg.m);
  } else if (!msg.m) {
    monster.hide();
  }
}

function addRemote(p) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: p.color, transparent: true });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 4, 8), mat);
  body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), mat);
  head.position.y = 1.55;
  group.add(body, head);
  group.add(nameSprite(p.name));
  let light = null;
  if (!isTouch) {
    light = new THREE.SpotLight(0xfff2d8, 20, 18, 0.42, 0.5, 1.5);
    light.position.set(0, 1.5, 0.2);
    light.target.position.set(0, 1.2, 3);
    group.add(light, light.target);
  }
  group.position.set(p.p[0], 0, p.p[2]);
  scene.add(group);
  const r = { group, body, mat, light, target: new THREE.Vector3(p.p[0], 0, p.p[2]), yaw: p.yaw, stepDist: 0, alive: true };
  remotes.set(p.id, r);
  return r;
}

function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  scene.remove(r.group);
  remotes.delete(id);
}

function nameSprite(name) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText(name, 128, 44);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  s.scale.set(1.2, 0.3, 1);
  s.position.y = 2.05;
  return s;
}

function updateRemotes(dt) {
  const k = 1 - Math.exp(-dt * 12);
  for (const r of remotes.values()) {
    const before = r.group.position.clone();
    r.group.position.lerp(r.target, k);
    let d = r.yaw - r.group.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    r.group.rotation.y += d * k;
    r.group.scale.y += ((r.crouch ? 0.65 : 1) - r.group.scale.y) * k;
    r.mat.opacity = r.alive ? 1 : 0.2;
    if (r.light) r.light.intensity = r.alive && r.lightOn ? 20 : 0;
    // Pasos de los compañeros, en 3D
    if (r.alive) {
      r.stepDist += before.distanceTo(r.group.position);
      const stride = r.crouch ? 0.9 : 1.6;
      if (r.stepDist > stride) {
        r.stepDist = 0;
        audio.footstep(r.group.position, { volume: r.crouch ? 0.12 : 0.45 });
      }
    }
  }
}

// ---- Fantasma y susto ----
function becomeGhost() {
  player.alive = false;
  player.crouch = false;
  toast('Eres un fantasma: el monstruo ya no te ve. Ayuda a tus amigos mirando.', 4000);
}

function startScare(mpos) {
  scare = { t: 0, flash: 0 };
  $('click-to-play').classList.add('hidden');
  player.frozen = true;
  player.alive = false;
  // Coloca al monstruo pegado a la cara del jugador
  const dir = new THREE.Vector3(mpos[0] - player.pos.x, 0, mpos[1] - player.pos.z);
  if (dir.lengthSq() < 0.01) camera.getWorldDirection(dir).setY(0);
  dir.normalize();
  monster.root.visible = true;
  monster.has = true;
  monster.state = 'scare';
  monster.playFor('scare');
  const at = player.pos.clone().addScaledVector(dir, 1.05);
  monster.root.position.copy(at);
  monster.target.copy(at);
  monster.root.rotation.y = monster.targetYaw = Math.atan2(-dir.x, -dir.z);
  audio.scream();
}

const _head = new THREE.Vector3();
function updateScare(dt) {
  scare.t += dt * 1000;
  const p = scare.t / JUMPSCARE_MS;
  monster.headWorldPosition(_head);
  camera.position.set(player.pos.x, PLAYER.eyeHeight, player.pos.z);
  camera.lookAt(_head.x, _head.y - 0.15, _head.z);
  // Temblor de cámara y zoom hacia la cara
  const shake = 0.06 * (1 - p * 0.5);
  camera.rotation.x += (Math.random() - 0.5) * shake;
  camera.rotation.y += (Math.random() - 0.5) * shake;
  camera.fov = 75 - Math.min(1, p * 4) * 25;
  camera.updateProjectionMatrix();
  monster.faceLight.intensity = 6 + Math.random() * 6;

  // Flashes blancos y rojos
  scare.flash -= dt;
  const el = $('scare');
  el.classList.remove('hidden');
  if (scare.flash <= 0) {
    scare.flash = 0.05 + Math.random() * 0.07;
    const r = Math.random();
    el.style.background = r < 0.35 ? 'rgba(255,255,255,0.85)' : r < 0.7 ? 'rgba(200,0,0,0.65)' : 'transparent';
  }
  if (scare.t >= JUMPSCARE_MS) {
    el.classList.add('hidden');
    camera.fov = 75;
    camera.updateProjectionMatrix();
    scare = null;
    player.frozen = phase !== 'playing';
    updateClickToPlay();
    toast('Te ha atrapado. Ahora eres un fantasma.', 3500);
  }
}

// ---- Interacción ----
player.onStep = (mode) => {
  const vol = mode === 'run' ? 0.5 : mode === 'crouch' ? 0.06 : 0.22;
  audio.footstep(null, { volume: vol });
};
player.onUse = () => {
  if (nearestItem && phase === 'playing') net.send({ t: 'pickup', id: nearestItem.data.id });
};

canvas.addEventListener('click', () => {
  audio.unlock();
  if (!isTouch && phase === 'playing') canvas.requestPointerLock?.();
});
document.addEventListener('pointerlockchange', updateClickToPlay);
function updateClickToPlay() {
  const show = !isTouch && phase === 'playing' && !scare && document.pointerLockElement !== canvas;
  $('click-to-play').classList.toggle('hidden', !show);
  if (!isTouch && phase === 'playing' && !scare) player.frozen = !!show;
}
// En móvil el audio se desbloquea con el primer toque
addEventListener('touchstart', () => audio.unlock(), { passive: true });

let toastTimer = null;
function toast(text, ms = 2500) {
  const el = $('toast');
  el.textContent = text;
  el.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.opacity = 0), ms);
}

// ---- Bucle principal ----
const clock = new THREE.Clock();
let sendTimer = 0;
let heartTimer = 0;
let scareTimer = 30;
let blackout = 0;
const _v = new THREE.Vector3();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  if (scare) updateScare(dt);
  else player.update(dt);

  if (net && phase === 'playing') {
    sendTimer -= dt;
    if (sendTimer <= 0) {
      sendTimer = 1 / TICK_RATE;
      net.send({
        t: 'state',
        p: [player.pos.x, 0, player.pos.z],
        yaw: player.facing, noise: player.noise, crouch: player.crouch, light: player.light,
      });
    }
  }

  updateRemotes(dt);
  const monsterMoved = monster.update(dt, time);
  if (monster.root.visible && !scare) {
    monster.stepDist += monsterMoved;
    if (monster.stepDist > 1.7) {
      monster.stepDist = 0;
      audio.footstep(monster.root.position, { volume: monster.state === 'chase' ? 1.2 : 0.7, heavy: true });
    }
  }
  audio.updateListener(camera);
  audio.updateMonster(monster.root.position.x, monster.root.position.z, monster.state, monster.root.visible && phase === 'playing');

  if (phase === 'playing') updateGameplay(dt, time);
  updateLamps(dt);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function updateGameplay(dt, time) {
  // Producto más cercano
  nearestItem = null;
  let best = PLAYER.pickupRange;
  if (player.alive) {
    for (const it of items.values()) {
      if (it.data.takenBy) continue;
      const d = Math.hypot(it.data.x - player.pos.x, it.data.z - player.pos.z);
      if (d < best) { best = d; nearestItem = it; }
    }
  }
  for (const it of items.values()) {
    if (it.data.takenBy) continue;
    it.mesh.rotation.y += dt;
    it.mesh.material.emissiveIntensity = 0.35 + Math.sin(time * 3 + it.data.id) * 0.25;
  }
  const prompt = nearestItem ? (isTouch ? nearestItem.data.name : `E — coger ${nearestItem.data.name}`) : '';
  $('prompt').textContent = prompt;
  $('t-use').classList.toggle('hidden', !nearestItem);

  const allTaken = items.size > 0 && [...items.values()].every((it) => it.data.takenBy);
  world.setExitOpen(allTaken, time);
  if (allTaken && player.alive && inExitZone(player.pos.x, player.pos.z)) $('prompt').textContent = 'Esperando...';

  // Estamina
  $('stamina-fill').style.width = `${player.stamina * 100}%`;
  $('stamina').style.opacity = player.stamina < 0.99 ? 1 : 0.25;

  // Latido y viñeta roja según lo cerca que está el monstruo
  const md = monster.root.visible ? _v.copy(monster.root.position).setY(0).distanceTo(player.pos) : 99;
  const chasingMe = monster.state === 'chase' && monsterTarget === myId;
  heartTimer -= dt;
  if (player.alive && md < 16 && heartTimer <= 0) {
    heartTimer = 0.32 + (md / 16) * 0.8 - (chasingMe ? 0.1 : 0);
    audio.heartbeat((1 - md / 16) * 0.9);
  }
  const danger = player.alive ? Math.max(chasingMe ? 0.8 : 0, 1 - md / 12) : 0;
  $('vignette').style.boxShadow = `inset 0 0 160px 60px rgba(120,0,0,${danger * 0.7})`;

  // Sustos pequeños: apagón o un ruido detrás de ti
  scareTimer -= dt;
  if (scareTimer <= 0 && player.alive) {
    scareTimer = 25 + Math.random() * 25;
    if (Math.random() < 0.5) {
      blackout = 1.2 + Math.random() * 1.2;
    } else {
      const back = player.yaw + Math.PI * (0.7 + Math.random() * 0.6);
      const dist = 5 + Math.random() * 4;
      audio.clatter(player.pos.x - Math.sin(back) * dist, player.pos.z - Math.cos(back) * dist);
    }
  }
}

function updateLamps(dt) {
  blackout = Math.max(0, blackout - dt);
  audio.flickerHum(blackout > 0);
  for (const lamp of world.lamps) {
    if (blackout > 0) { lamp.setOn(false); continue; }
    lamp.off = Math.max(0, (lamp.off || 0) - dt);
    if (lamp.flicky && Math.random() < 0.012) lamp.off = 0.04 + Math.random() * 0.15;
    lamp.setOn(lamp.off <= 0);
  }
}

frame();
