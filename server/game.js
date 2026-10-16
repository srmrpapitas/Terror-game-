// Una sala de juego: jugadores, productos de la lista y la IA del monstruo.
// El servidor es el árbitro: mueve al monstruo, reparte productos y decide quién es atrapado.
import {
  SPAWN, MONSTER_SPAWN, PATROL_POINTS, ITEM_SPOTS, PRODUCTS, ITEMS_PER_ROUND,
  lineOfSight, inExitZone, resolveCircle,
} from '../shared/map.js';
import { PLAYER, MONSTER, TICK_RATE, MAX_PLAYERS, JUMPSCARE_MS } from '../shared/constants.js';
import { findPath, clearPath } from './nav.js';
import { Dinner } from './dinner.js';

const DT = 1 / TICK_RATE;
const PLAYER_COLORS = [0x4fc3f7, 0xffb74d, 0xaed581, 0xf06292];

export class Room {
  constructor(code, onEmpty) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.players = new Map(); // id -> player
    this.phase = 'lobby'; // lobby | playing | ended
    this.items = [];
    this.monster = null;
    this.hostId = null;
    this.mode = 'market'; // market (supermercado) | dinner (la cena)
    this.dinner = null;
    this.endTimer = 0;
    this.interval = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  // ---- Conexiones ----

  addPlayer(id, name, send) {
    if (this.players.size >= MAX_PLAYERS) return false;
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
    const player = {
      id, name, send, color,
      x: SPAWN.x + (Math.random() - 0.5) * 3, y: 0, z: SPAWN.z, yaw: Math.PI,
      noise: 0, crouch: false, light: true,
      coughIn: nextCough(), coughing: 0,
      // Quien entra a mitad de ronda espera como fantasma
      alive: this.phase !== 'playing',
    };
    this.players.set(id, player);
    if (!this.hostId) this.hostId = id;
    send({ t: 'joined', code: this.code, id, host: this.hostId === id, color });
    if (this.phase === 'playing') {
      this.dinner?.addSpectator(id);
      send(this.roundMessage());
    }
    this.broadcastLobby();
    return true;
  }

  removePlayer(id) {
    this.players.delete(id);
    this.dinner?.remove(id);
    if (this.monster?.targetId === id) this.monster.targetId = null;
    if (this.hostId === id) this.hostId = this.players.keys().next().value ?? null;
    if (this.players.size === 0) {
      clearInterval(this.interval);
      this.onEmpty(this.code);
      return;
    }
    this.broadcastLobby();
    this.checkEnd();
  }

  handle(id, msg) {
    const p = this.players.get(id);
    if (!p) return;
    switch (msg.t) {
      case 'start':
        if (id === this.hostId && this.phase !== 'playing') this.startRound();
        break;
      case 'mode':
        if (id === this.hostId && this.phase !== 'playing' && (msg.mode === 'market' || msg.mode === 'dinner')) {
          this.mode = msg.mode;
          this.broadcastLobby();
        }
        break;
      case 'load':
      case 'eat':
      case 'drop':
        if (this.phase === 'playing' && this.dinner) this.dinner.handle(id, msg);
        break;
      case 'state': {
        if (!Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(Number.isFinite)) return;
        // Evita que alguien atraviese paredes enviando posiciones imposibles
        const fixed = resolveCircle(msg.p[0], msg.p[2], PLAYER.radius);
        p.x = fixed.x; p.y = msg.p[1]; p.z = fixed.z;
        p.yaw = Number(msg.yaw) || 0;
        p.noise = Math.min(PLAYER.noise.run, Math.max(0, Number(msg.noise) || 0));
        p.crouch = !!msg.crouch;
        p.light = !!msg.light;
        break;
      }
      case 'pickup': {
        const item = this.items.find((it) => it.id === msg.id);
        if (this.phase !== 'playing' || !p.alive || !item || item.takenBy) return;
        if (Math.hypot(item.x - p.x, item.z - p.z) > PLAYER.pickupRange + 0.5) return;
        item.takenBy = id;
        this.broadcast({ t: 'taken', id: item.id, by: id, name: p.name });
        break;
      }
    }
  }

  // ---- Ronda ----

  startRound() {
    if (this.mode === 'dinner') return this.startDinner();
    this.dinner = null;
    const spots = [...ITEM_SPOTS].sort(() => Math.random() - 0.5);
    const products = [...PRODUCTS].sort(() => Math.random() - 0.5).slice(0, ITEMS_PER_ROUND);
    // Productos separados entre sí para obligar a recorrer la tienda
    const chosen = [];
    // Si no caben todos tan separados, se va bajando la distancia mínima
    for (const minDist of [9, 7, 5, 0]) {
      for (const s of spots) {
        if (chosen.length === products.length) break;
        if (chosen.every((c) => c !== s && Math.hypot(c.x - s.x, c.z - s.z) > minDist)) chosen.push(s);
      }
    }
    this.items = products.map((prod, i) => ({
      id: i, name: prod.name, color: prod.color,
      x: chosen[i].x, y: chosen[i].y, z: chosen[i].z, takenBy: null,
    }));

    let i = 0;
    for (const p of this.players.values()) {
      p.alive = true;
      p.coughIn = nextCough();
      p.coughing = 0;
      p.x = SPAWN.x - 2 + (i++) * 1.3;
      p.z = SPAWN.z;
    }

    this.monster = {
      x: MONSTER_SPAWN.x, z: MONSTER_SPAWN.z, yaw: Math.PI / 2,
      state: 'idle', stateTime: 0, wait: MONSTER.startDelay,
      targetId: null, lastKnown: null, lastSeen: 0, chaseTime: 0,
      path: [], repath: 0, scanStartYaw: 0, scanBest: null,
      patrolIdx: Math.floor(Math.random() * PATROL_POINTS.length),
    };
    this.phase = 'playing';
    this.endTimer = 0;
    this.broadcast(this.roundMessage());
  }

  startDinner() {
    for (const p of this.players.values()) p.alive = true;
    this.monster = null;
    this.items = [];
    this.dinner = new Dinner(this);
    this.phase = 'playing';
    this.endTimer = 0;
    this.broadcast(this.roundMessage());
  }

  roundMessage() {
    if (this.dinner) return { t: 'round', mode: 'dinner', d: this.dinner.snapshot() };
    return {
      mode: 'market',
      t: 'round',
      items: this.items.map(({ id, name, color, x, y, z, takenBy }) => ({ id, name, color, x, y, z, takenBy })),
    };
  }

  checkEnd() {
    if (this.phase !== 'playing') return;
    if (this.dinner) {
      if (this.dinner.over()) {
        this.phase = 'ended';
        this.broadcast({ t: 'end', result: 'dinner', ranking: this.dinner.ranking() });
      }
      return;
    }
    const alive = [...this.players.values()].filter((p) => p.alive);
    const allTaken = this.items.every((it) => it.takenBy !== null);
    let result = null;
    if (alive.length === 0) result = 'lose';
    else if (allTaken && alive.some((p) => inExitZone(p.x, p.z))) result = 'win';
    if (result) {
      this.phase = 'ended';
      this.endTimer = 0;
      this.broadcast({ t: 'end', result });
    }
  }

  // ---- Simulación ----

  tick() {
    if (this.phase === 'playing') {
      if (this.dinner) this.dinner.tick(DT);
      else this.updateMonster();
      this.checkEnd();
    }
    const snap = {
      t: 'snap',
      phase: this.phase,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, color: p.color,
        p: [round(p.x), round(p.y), round(p.z)], yaw: round(p.yaw),
        alive: p.alive, crouch: p.crouch, light: p.light, noise: p.noise,
      })),
    };
    if (this.dinner) snap.d = this.dinner.snapshot();
    if (this.monster && this.phase !== 'lobby') {
      const m = this.monster;
      snap.m = { p: [round(m.x), round(m.z)], yaw: round(m.yaw), state: m.state, target: m.targetId, anger: round(this.anger()) };
    }
    this.broadcast(snap);
  }

  // Rabia del monstruo: 0 al empezar, 1 con toda la lista cogida. Cuanto más os
  // lleváis, más rápido corre, más lejos oye y más tiempo persigue antes de pararse.
  anger() {
    if (!this.items.length) return 0;
    return this.items.filter((it) => it.takenBy !== null).length / this.items.length;
  }

  // Ruido que hace ahora un jugador: al moverse, o al toser sin querer.
  noiseOf(p) {
    const n = Math.max(p.noise, p.coughing > 0 ? PLAYER.coughNoise : 0);
    return n * (1 + MONSTER.anger.hearing * this.anger());
  }

  // Cada cierto tiempo cada jugador tose aunque esté quieto.
  updateCoughs() {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      p.coughing -= DT;
      p.coughIn -= DT;
      if (p.coughIn <= 0) {
        p.coughIn = nextCough();
        p.coughing = 1;
        this.broadcast({ t: 'cough', id: p.id, p: [round(p.x), round(p.z)] });
      }
    }
  }

  updateMonster() {
    this.updateCoughs();
    const m = this.monster;
    m.stateTime += DT;
    const alive = [...this.players.values()].filter((p) => p.alive);

    if (m.state === 'idle' || m.state === 'feed') {
      m.wait -= DT;
      if (m.wait <= 0) this.setState('patrol');
      return;
    }

    // ¿Atrapa a alguien? Si te quedas totalmente quieto no te ataca
    for (const p of alive) {
      if (this.noiseOf(p) > 0 && Math.hypot(p.x - m.x, p.z - m.z) < MONSTER.catchRange) {
        this.catchPlayer(p);
        return;
      }
    }

    const seen = this.visiblePlayers(alive);

    if (m.state === 'scan') {
      // Gira 360° buscando objetivos
      m.yaw = m.scanStartYaw + (m.stateTime / MONSTER.scanDuration) * Math.PI * 2;
      for (const s of seen) {
        if (!m.scanBest || s.dist < m.scanBest.dist) m.scanBest = { id: s.p.id, dist: s.dist };
      }
      if (m.stateTime >= MONSTER.scanDuration) {
        const best = m.scanBest && this.players.get(m.scanBest.id);
        if (best?.alive) {
          this.startChase(best);
        } else if (m.lastKnown) {
          this.setState('investigate');
          m.path = findPath(m.x, m.z, m.lastKnown.x, m.lastKnown.z);
        } else {
          this.setState('patrol');
        }
      }
      return;
    }

    if (m.state === 'chase') {
      const target = this.players.get(m.targetId);
      if (!target?.alive) {
        this.startScan();
        return;
      }
      // Mientras te persigue no te pierde si te tiene a la vista y te oye (tus pasos en
      // línea recta por el pasillo); para despistarlo hay que doblar una esquina
      const dist = Math.hypot(target.x - m.x, target.z - m.z);
      const sees = seen.find((s) => s.p.id === target.id) ||
        (dist < this.noiseOf(target) && lineOfSight(m.x, m.z, target.x, target.z));
      if (sees) {
        m.lastKnown = { x: target.x, z: target.z };
        m.lastSeen = 0;
      } else {
        m.lastSeen += DT;
        if (m.lastSeen > MONSTER.loseSightAfter) {
          this.setState('investigate');
          m.path = findPath(m.x, m.z, m.lastKnown.x, m.lastKnown.z);
          return;
        }
      }
      m.chaseTime += DT;
      if (m.chaseTime >= MONSTER.chaseBeforeScan + MONSTER.anger.chaseLonger * this.anger()) {
        this.startScan();
        return;
      }
      const goal = sees ? target : m.lastKnown;
      this.moveToward(goal, MONSTER.chaseSpeed * (1 + MONSTER.anger.speed * this.anger()));
      return;
    }

    // Patrulla o investigación: si ve a alguien, a por él
    if (seen.length) {
      seen.sort((a, b) => a.dist - b.dist);
      this.startChase(seen[0].p);
      return;
    }
    const heard = this.loudestHeard(alive);
    if (heard && (m.state !== 'investigate' || m.repath <= 0)) {
      // Oír no es ver: va hacia donde cree que sonó, con más error cuanto más lejos
      const err = Math.hypot(heard.x - m.x, heard.z - m.z) * MONSTER.hearingError;
      const a = Math.random() * Math.PI * 2;
      const guess = resolveCircle(heard.x + Math.cos(a) * err, heard.z + Math.sin(a) * err, MONSTER.radius);
      m.lastKnown = guess;
      this.setState('investigate');
      m.path = findPath(m.x, m.z, guess.x, guess.z);
      m.repath = 2;
    }
    m.repath -= DT;

    const speed = (m.state === 'investigate' ? MONSTER.investigateSpeed : MONSTER.patrolSpeed) * (1 + MONSTER.anger.speed * this.anger());
    if (!m.path.length) {
      if (m.state === 'investigate') {
        // Llegó al sitio del ruido: mira alrededor
        this.startScan();
        return;
      }
      m.patrolIdx = (m.patrolIdx + 1 + Math.floor(Math.random() * 3)) % PATROL_POINTS.length;
      const pt = PATROL_POINTS[m.patrolIdx];
      m.path = findPath(m.x, m.z, pt.x, pt.z);
      return;
    }
    this.followPath(speed);
  }

  // El monstruo no ve en la oscuridad: solo distingue la luz de las linternas, y a
  // quien está completamente quieto lo ignora aunque lo tenga delante.
  visiblePlayers(alive) {
    const m = this.monster;
    const out = [];
    for (const p of alive) {
      if (!this.noiseOf(p)) continue;
      const dx = p.x - m.x, dz = p.z - m.z;
      const dist = Math.hypot(dx, dz);
      if (dist < MONSTER.closeSense) {
        out.push({ p, dist });
        continue;
      }
      if (!p.light) continue;
      // Si le apuntas con la linterna te ve de lejos; si el haz va hacia otro lado
      // (por ejemplo, huyendo) solo distingue el resplandor de cerca
      const toMonster = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - p.yaw));
      let range = toMonster < MONSTER.beamAngle ? MONSTER.sightRangeFlashlight : MONSTER.sightRangeGlow;
      if (p.crouch) range *= 0.6;
      if (dist > range) continue;
      const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - m.yaw));
      if (ang > MONSTER.fov / 2) continue;
      if (!lineOfSight(m.x, m.z, p.x, p.z)) continue;
      out.push({ p, dist });
    }
    return out;
  }

  loudestHeard(alive) {
    const m = this.monster;
    let best = null, bestScore = 0;
    for (const p of alive) {
      const noise = this.noiseOf(p);
      if (!noise) continue;
      const dist = Math.hypot(p.x - m.x, p.z - m.z);
      // A través de estanterías se oye peor
      const radius = lineOfSight(m.x, m.z, p.x, p.z) ? noise : noise * 0.7;
      if (dist < radius && radius - dist > bestScore) {
        bestScore = radius - dist;
        best = p;
      }
    }
    return best;
  }

  startChase(p) {
    const m = this.monster;
    const wasChasing = m.state === 'chase';
    this.setState('chase');
    m.targetId = p.id;
    m.lastKnown = { x: p.x, z: p.z };
    m.lastSeen = 0;
    m.chaseTime = 0;
    m.path = [];
    if (!wasChasing) this.broadcast({ t: 'roar', target: p.id });
  }

  startScan() {
    const m = this.monster;
    this.setState('scan');
    m.scanStartYaw = m.yaw;
    m.scanBest = null;
    m.path = [];
  }

  setState(state) {
    const m = this.monster;
    m.state = state;
    m.stateTime = 0;
    if (state !== 'chase') m.targetId = state === 'scan' ? m.targetId : null;
  }

  catchPlayer(p) {
    const m = this.monster;
    p.alive = false;
    m.yaw = Math.atan2(p.x - m.x, p.z - m.z);
    this.broadcast({ t: 'caught', id: p.id, name: p.name, m: [m.x, m.z] });
    this.setState('feed');
    // Espera a que termine el susto y un poco más antes de volver a cazar
    m.wait = MONSTER.feedDuration + JUMPSCARE_MS / 1000;
    m.targetId = null;
    m.lastKnown = null;
    m.path = [];
  }

  // Persigue un punto: en línea recta si se puede, si no con A*.
  moveToward(goal, speed) {
    const m = this.monster;
    if (clearPath(m.x, m.z, goal.x, goal.z)) {
      m.path = [{ x: goal.x, z: goal.z }];
    } else if (m.repath <= 0 || !m.path.length) {
      m.path = findPath(m.x, m.z, goal.x, goal.z);
      m.repath = 0.3;
    }
    m.repath -= DT;
    this.followPath(speed);
  }

  followPath(speed) {
    const m = this.monster;
    let step = speed * DT;
    while (step > 0 && m.path.length) {
      const wp = m.path[0];
      const dx = wp.x - m.x, dz = wp.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) { m.path.shift(); continue; }
      const desired = Math.atan2(dx, dz);
      const diff = wrapAngle(desired - m.yaw);
      m.yaw += Math.sign(diff) * Math.min(Math.abs(diff), MONSTER.turnSpeed * DT);
      const mv = Math.min(step, d);
      m.x += (dx / d) * mv;
      m.z += (dz / d) * mv;
      step -= mv;
      if (mv >= d) m.path.shift();
    }
    const fixed = resolveCircle(m.x, m.z, MONSTER.radius);
    m.x = fixed.x;
    m.z = fixed.z;
  }

  // ---- Envío ----

  broadcast(msg) {
    for (const p of this.players.values()) p.send(msg);
  }

  broadcastLobby() {
    this.broadcast({
      t: 'lobby',
      host: this.hostId,
      phase: this.phase,
      mode: this.mode,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color })),
    });
  }
}

function nextCough() {
  return PLAYER.coughEvery * (0.75 + Math.random() * 0.5);
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function round(v) {
  return Math.round(v * 100) / 100;
}
