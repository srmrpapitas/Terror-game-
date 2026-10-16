import * as THREE from 'three';
import { buildWorld } from './world.js';
import { MonsterView } from './monster.js';
import { LocalPlayer } from './player.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { buildCart, addToCart, emptyCart } from './cart.js';
import { DinnerView } from './dinner.js';
import { SPAWN, inExitZone } from '../shared/map.js';
import { PLAYER, JUMPSCARE_MS, TICK_RATE, DINNER } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.toggle('touch', isTouch);

// ---- Render ----
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, isTouch ? 34 : 40);
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
// Tu carrito: va delante de ti y en él se ven los productos que coges
const myCart = buildCart();
scene.add(myCart);
const _cartPrev = new THREE.Vector3();
const dinner = new DinnerView({ monster, audio, isTouch, toast: (t, ms) => toast(t, ms) });

// El anfitrión no puede empezar hasta tener el monstruo cargado (el FBX pesa ~12 MB)
$('loading').classList.remove('hidden');
$('btn-start').disabled = true;
$('btn-start').textContent = 'Cargando al monstruo...';
monster.load('/models/warrok.fbx', (ok) => {
  if (!ok) toast('No se pudo cargar el monstruo: se usa la figura provisional', 6000);
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
async function shareRoom(btn, label) {
  const url = `${location.origin}${location.pathname}?sala=${roomCode}`;
  try {
    if (navigator.share && isTouch) await navigator.share({ title: 'Última Compra', url });
    else await navigator.clipboard.writeText(url);
    btn.textContent = 'Enlace copiado';
  } catch {
    btn.textContent = url;
  }
  if (label) setTimeout(() => (btn.textContent = label), 2500);
}
$('btn-share').onclick = () => shareRoom($('btn-share'));
// En la cena el código de sala queda a la vista para invitar a más gente
$('d-room').onclick = () => shareRoom($('d-room'), `Sala ${roomCode} · Invitar`);

// ---- Elegir juego (lo decide el anfitrión) ----
const MODE_TEXT = {
  market: 'Coged la lista de la compra y salid sin que os atrape el monstruo.',
  dinner: 'Comeos los guisantes sin que el del periódico os vea. Si os pilla, disparo. Gana quien limpie antes el plato.',
};
let currentMode = 'market';
function showMode(mode, amHost) {
  currentMode = mode;
  $('btn-switch').textContent = mode === 'market' ? 'Jugar a La Cena' : 'Jugar al Supermercado';
  $('btn-switch').classList.toggle('hidden', !amHost);
  $('mode-market').classList.toggle('on', mode === 'market');
  $('mode-dinner').classList.toggle('on', mode === 'dinner');
  $('mode-market').disabled = $('mode-dinner').disabled = !amHost;
  $('mode-desc').textContent = MODE_TEXT[mode];
}
$('btn-switch').onclick = () => {
  net?.send({ t: 'mode', mode: currentMode === 'market' ? 'dinner' : 'market' });
  net?.send({ t: 'start' });
};
$('mode-market').onclick = () => net?.send({ t: 'mode', mode: 'market' });
$('mode-dinner').onclick = () => net?.send({ t: 'mode', mode: 'dinner' });

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
      $('d-room').textContent = `Sala ${msg.code} · Invitar`;
      history.replaceState(null, '', `?sala=${msg.code}`);
      break;
    case 'lobby': {
      hostId = msg.host;
      lastPlayers = msg.players;
      const ul = $('lobby-players');
      ul.innerHTML = '';
      for (const p of msg.players) {
        const li = document.createElement('li');
        li.textContent = p.name + (p.id === msg.host ? ' (anfitrión)' : '') + (p.id === myId ? ' · tú' : '');
        li.style.borderColor = '#' + p.color.toString(16).padStart(6, '0');
        ul.appendChild(li);
      }
      const amHost = hostId === myId;
      showMode(msg.mode || 'market', amHost);
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
      if (dinner.active) {
        if (msg.d) dinner.onSnap(msg.d, playerInfo(msg.players));
        renderDinnerCount();
      } else onSnapshot(msg);
      break;
    case 'shot':
      dinner.onShot(msg.id);
      if (msg.id !== myId) toast(`¡PUM! ${msg.name} ha caído`, 2500);
      break;
    case 'cleaned':
      toast(msg.id === myId ? `¡Plato limpio! Quedas ${msg.place}º` : `${msg.name} ha limpiado el plato (${msg.place}º)`, 3000);
      break;
    case 'taken': {
      const it = items.get(msg.id);
      if (it) {
        it.data.takenBy = msg.by;
        scene.remove(it.mesh);
        const cart = msg.by === myId ? myCart : remotes.get(msg.by)?.cart;
        if (cart) addToCart(cart, it.data.color);
      }
      if (msg.by === myId) audio.pickup();
      toast(`${msg.by === myId ? 'Has cogido' : msg.name + ' ha cogido'}: ${it?.data.name ?? ''}`);
      renderList();
      break;
    }
    case 'cough':
      if (msg.id === myId) {
        audio.cough(null);
        toast('*cof, cof* ...se te ha escapado una tos', 1800);
      } else {
        audio.cough({ x: msg.p[0], y: 1.5, z: msg.p[1] });
      }
      break;
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
      endRound(msg.result, msg.ranking);
      break;
  }
}

function playerInfo(list) {
  return new Map(list.map((p) => [p.id, { name: p.name, color: p.color }]));
}

let lastPlayers = [];
function startDinner(msg) {
  phase = 'playing';
  player.frozen = true;
  document.exitPointerLock?.();
  scare = null;
  pendingEnd = null;
  dinner.start(myId, msg.d, playerInfo(lastPlayers));
  audio.flickerHum(true);
  $('menu').classList.add('hidden');
  $('end').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
  $('dinner-ui').classList.remove('hidden');
  renderDinnerCount();
  toast('Carga guisantes mientras lee. Cada pinchazo y cada bocado hacen ruido y le hacen bajar antes el periódico.', 5500);
}

function renderDinnerCount() {
  const me = dinner.mine();
  if (!me) return;
  $('dinner-count').textContent = me.place
    ? `Plato limpio · ${me.place}º`
    : me.alive ? `Plato: ${me.peas - me.fork} · Tenedor: ${me.fork}` : 'Eliminado';
  $('dinner-buttons').classList.toggle('hidden', !me.alive || !!me.place);
}

function startRound(msg) {
  if (msg.mode === 'dinner') return startDinner(msg);
  if (dinner.active) {
    dinner.stop(scene);
    audio.flickerHum(false);
    $('dinner-ui').classList.add('hidden');
  }
  phase = 'playing';
  for (const it of items.values()) scene.remove(it.mesh);
  items = new Map();
  emptyCart(myCart);
  angerLevel = 0;
  for (const r of remotes.values()) emptyCart(r.cart);
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

let pendingEnd = null;
function endDinner(ranking) {
  phase = 'ended';
  $('toast').style.opacity = 0;
  $('dinner-ui').classList.add('hidden');
  $('end').classList.remove('hidden');
  const mine = ranking.find((r) => r.id === myId);
  $('end-title').textContent = mine?.place === 1 ? 'PRIMERO' : mine?.place ? `${mine.rank}º PUESTO` : 'TE PILLARON';
  $('end-text').textContent = 'Clasificación de la cena';
  const ol = $('ranking');
  ol.innerHTML = '';
  for (const r of ranking) {
    const li = document.createElement('li');
    li.textContent = `${r.name}${r.id === myId ? ' (tú)' : ''}: ${r.place ? 'plato limpio' : `disparado (le quedaban ${r.left})`}`;
    if (!r.place) li.classList.add('dead');
    ol.appendChild(li);
  }
}

function endRound(result, ranking) {
  // Si te acaban de atrapar, primero termina el susto
  if (scare || dinner.shot) {
    pendingEnd = { result, ranking };
    return;
  }
  $('ranking').classList.toggle('hidden', result !== 'dinner');
  if (result === 'dinner') return endDinner(ranking);
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
    const level = Math.floor((msg.m.anger || 0) * 3 + 1e-6);
    if (level > angerLevel) {
      angerLevel = level;
      toast(['', 'Algo ruge a lo lejos... se está enfadando.', 'El monstruo está furioso. Cada vez oye mejor.', 'Te has llevado todo. Ahora va a por ti con todo.'][Math.min(level, 3)], 3000);
      audio.roar(monster.root.position.x, monster.root.position.z);
    }
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
    light = new THREE.SpotLight(0xfff2d8, 45, 28, 0.48, 0.4, 1.3);
    light.position.set(0, 1.5, 0.2);
    light.target.position.set(0, 1.2, 3);
    group.add(light, light.target);
  }
  group.position.set(p.p[0], 0, p.p[2]);
  scene.add(group);
  const cart = buildCart();
  scene.add(cart);
  const r = { group, body, mat, light, cart, target: new THREE.Vector3(p.p[0], 0, p.p[2]), yaw: p.yaw, stepDist: 0, alive: true };
  remotes.set(p.id, r);
  return r;
}

function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  scene.remove(r.group);
  scene.remove(r.cart);
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
    placeCart(r.cart, r.group.position, r.group.rotation.y, r.alive);
    if (r.light) r.light.intensity = r.alive && r.lightOn ? 45 : 0;
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

function placeCart(cart, pos, facing, visible) {
  cart.visible = visible;
  cart.position.set(pos.x + Math.sin(facing) * 0.45, 0, pos.z + Math.cos(facing) * 0.45);
  cart.rotation.y = facing;
}

// Tu carrito sigue a la cámara; al moverte traquetea (y el monstruo lo oye).
function updateMyCart(dt) {
  placeCart(myCart, player.pos, player.facing, player.alive && phase === 'playing');
  const speed = myCart.visible ? _cartPrev.distanceTo(myCart.position) / Math.max(dt, 1e-3) : 0;
  _cartPrev.copy(myCart.position);
  audio.cartRattle(Math.min(speed, 8), player.crouch);
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
    if (pendingEnd) {
      endRound(pendingEnd.result, pendingEnd.ranking);
      pendingEnd = null;
      return;
    }
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
  if (!isTouch && phase === 'playing' && !dinner.active) canvas.requestPointerLock?.();
});
document.addEventListener('pointerlockchange', updateClickToPlay);
function updateClickToPlay() {
  const show = !isTouch && phase === 'playing' && !scare && !dinner.active && document.pointerLockElement !== canvas;
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
let angerLevel = 0; // 0-3, para avisar cuando el monstruo se enfada más
let scareTimer = 30;
let blackout = 0;
const _v = new THREE.Vector3();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  if (dinner.active) {
    const wasShot = !!dinner.shot;
    dinner.update(dt, time);
    if (wasShot && !dinner.shot) {
      renderDinnerCount();
      if (pendingEnd) {
        endRound(pendingEnd.result, pendingEnd.ranking);
        pendingEnd = null;
      }
    }
    renderer.render(dinner.scene, dinner.camera);
    requestAnimationFrame(frame);
    return;
  }

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
  updateMyCart(dt);
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
  // Bombillas de los pasillos: rachas encendidas o apagadas, con parpadeos al cambiar
  for (const b of world.bulbs) {
    b.timer -= dt;
    if (b.timer <= 0) {
      b.on = !b.on;
      b.timer = b.on ? 2 + Math.random() * 7 : 1 + Math.random() * 5;
      b.flick = 0.6 + Math.random() * 0.6;
    }
    b.flick = Math.max(0, b.flick - dt);
    let k = b.on ? 1 : 0;
    if (b.flick > 0) k = Math.random() < 0.5 ? 1 : 0.1;
    else if (b.on && Math.random() < 0.01) k = 0.3; // pequeño bajón de vez en cuando
    if (blackout > 0) k = 0;
    b.setLevel(k * (0.85 + Math.random() * 0.15));
  }
  blackout = Math.max(0, blackout - dt);
  audio.flickerHum(blackout > 0);
  for (const lamp of world.lamps) {
    if (blackout > 0) { lamp.setOn(false); continue; }
    lamp.off = Math.max(0, (lamp.off || 0) - dt);
    if (lamp.flicky && Math.random() < 0.012) lamp.off = 0.04 + Math.random() * 0.15;
    lamp.setOn(lamp.off <= 0);
  }
}

// ---- Controles de La Cena ----
let loadTimer = null;
function dinnerSend(t) {
  if (dinner.active && phase === 'playing' && !dinner.shot) net?.send({ t });
}
function startLoading() {
  dinnerSend('load');
  clearInterval(loadTimer);
  loadTimer = setInterval(() => dinnerSend('load'), DINNER.loadInterval * 1000 + 30);
}
function stopLoading() {
  clearInterval(loadTimer);
  loadTimer = null;
}
for (const [id, fn] of [['d-eat', () => dinnerSend('eat')], ['d-drop', () => dinnerSend('drop')]]) {
  $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); audio.unlock(); fn(); });
}
// Cargar: un toque = un guisante; mantener pulsado = va cargando
$('d-load').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); audio.unlock(); startLoading(); });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('d-load').addEventListener(ev, stopLoading);
addEventListener('keydown', (e) => {
  if (!dinner.active || e.repeat) return;
  if (e.code === 'Space') startLoading();
  if (e.code === 'KeyE') dinnerSend('eat');
  if (e.code === 'KeyQ') dinnerSend('drop');
});
addEventListener('keyup', (e) => { if (e.code === 'Space') stopLoading(); });
// Mirar alrededor arrastrando (y en PC, clic corto en la pantalla = cargar)
let dragging = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!dinner.active) return;
  dragging = { x: e.clientX, y: e.clientY, moved: 0 };
});
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
  dragging.moved += Math.abs(dx) + Math.abs(dy);
  dragging.x = e.clientX;
  dragging.y = e.clientY;
  dinner.drag(dx, dy);
});
addEventListener('pointerup', () => {
  if (dragging && dragging.moved < 6 && !isTouch) dinnerSend('load');
  dragging = null;
});

// Acceso para depurar desde la consola del navegador
window.__uc = { monster, player, camera, scene, dinner };

frame();
