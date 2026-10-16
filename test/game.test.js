// Prueba de extremo a extremo del servidor: salas, productos y el monstruo atrapando a un jugador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createServer } from '../server/index.js';
import { findPath } from '../server/nav.js';
import { SPAWN, MONSTER_SPAWN, PATROL_POINTS, ITEM_SPOTS, collides } from '../shared/map.js';
import { MONSTER, TICK_RATE } from '../shared/constants.js';
import { Room } from '../server/game.js';

function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const msg = JSON.parse(d);
    inbox.push(msg);
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  });
  return {
    ws,
    open: new Promise((r) => ws.on('open', r)),
    send: (m) => ws.send(JSON.stringify(m)),
    wait: (pred, ms = 8000) => new Promise((resolve, reject) => {
      const found = inbox.find(pred);
      if (found) return resolve(found);
      const w = { pred, resolve };
      waiters.push(w);
      setTimeout(() => reject(new Error('timeout')), ms).unref();
    }),
  };
}

test('el mapa es navegable', () => {
  assert.ok(ITEM_SPOTS.length > 40);
  assert.ok(!collides(SPAWN.x, SPAWN.z, 0.4));
  for (const p of PATROL_POINTS) {
    assert.ok(findPath(MONSTER_SPAWN.x, MONSTER_SPAWN.z, p.x, p.z).length > 0, `sin camino a ${p.x},${p.z}`);
  }
});

test('sala multijugador: unirse, coger productos y ser atrapado', async () => {
  MONSTER.startDelay = 0.2;
  const { server, rooms } = await createServer(0, { dev: false });
  const port = server.address().port;
  const a = client(port), b = client(port);
  await Promise.all([a.open, b.open]);

  a.send({ t: 'create', name: 'Ana' });
  const joinedA = await a.wait((m) => m.t === 'joined');
  assert.equal(joinedA.host, true);
  b.send({ t: 'join', code: joinedA.code, name: 'Beto' });
  const joinedB = await b.wait((m) => m.t === 'joined');
  assert.equal(joinedB.host, false);

  b.send({ t: 'start' }); // solo el anfitrión puede empezar
  a.send({ t: 'start' });
  const round = await b.wait((m) => m.t === 'round');
  assert.equal(round.items.length, 8);

  // Beto coge un producto estando al lado
  const item = round.items[0];
  b.send({ t: 'state', p: [item.x, 0, item.z], yaw: 0, noise: 0, crouch: false, light: true });
  await new Promise((r) => setTimeout(r, 100));
  b.send({ t: 'pickup', id: item.id });
  const taken = await a.wait((m) => m.t === 'taken');
  assert.equal(taken.id, item.id);
  assert.equal(taken.by, joinedB.id);

  // Ana corre haciendo ruido delante del monstruo: debe ir a por ella y atraparla
  const room = rooms.get(joinedA.code);
  const keepNoisy = setInterval(() => {
    a.send({ t: 'state', p: [MONSTER_SPAWN.x + 6, 0, MONSTER_SPAWN.z], yaw: 0, noise: 14, crouch: false, light: true });
  }, 50);
  const roar = await a.wait((m) => m.t === 'roar', 5000);
  assert.equal(roar.target, joinedA.id);
  const caught = await a.wait((m) => m.t === 'caught', 8000);
  clearInterval(keepNoisy);
  assert.equal(caught.id, joinedA.id);
  assert.equal(room.players.get(joinedA.id).alive, false);

  a.ws.close();
  b.ws.close();
  server.close();
});

test('el monstruo se para a mirar 360 tras 5 s de persecución', () => {
  const room = new Room('TEST', () => {});
  clearInterval(room.interval); // simulamos los ticks a mano
  room.addPlayer('1', 'Ana', () => {});
  room.startRound();
  const m = room.monster;
  Object.assign(m, { x: 5, z: 18.5, yaw: Math.PI / 2, state: 'patrol', path: [] });
  const states = [];
  // El jugador huye por el pasillo central, siempre 7 m por delante, alumbrando hacia el monstruo
  for (let i = 0; i < 8 * TICK_RATE; i++) {
    room.handle('1', { t: 'state', p: [Math.min(56, m.x + 7), 0, 18.5], yaw: -Math.PI / 2, noise: 14, crouch: false, light: true });
    room.tick();
    states.push(m.state);
  }
  const chaseStart = states.indexOf('chase');
  const scanStart = states.indexOf('scan');
  assert.ok(chaseStart >= 0, 'nunca persiguió');
  assert.ok(scanStart > chaseStart, 'nunca se paró a mirar');
  const chaseSeconds = (scanStart - chaseStart) / TICK_RATE;
  assert.ok(Math.abs(chaseSeconds - MONSTER.chaseBeforeScan) < 0.2, `persiguió ${chaseSeconds} s`);
  // Tras el giro vuelve a perseguir al jugador que sigue viendo
  assert.equal(states[scanStart + MONSTER.scanDuration * TICK_RATE + 1], 'chase');
});

test('quieto no te ataca, pero una tos te delata', () => {
  const room = new Room('TEST', () => {});
  clearInterval(room.interval);
  room.addPlayer('1', 'Ana', () => {});
  room.startRound();
  const p = room.players.get('1');
  const m = room.monster;
  // Quieto, con la linterna encendida y el monstruo pegado a ti
  p.coughIn = 999;
  Object.assign(m, { x: 5, z: 18.5, yaw: Math.PI / 2, state: 'patrol', path: [] });
  for (let i = 0; i < 3 * TICK_RATE; i++) {
    room.handle('1', { t: 'state', p: [6, 0, 18.5], yaw: 0, noise: 0, crouch: false, light: true });
    m.x = 5; m.z = 18.5;
    room.tick();
    assert.notEqual(m.state, 'chase');
  }
  assert.equal(p.alive, true);
  // Se le escapa una tos: ahora sí va a por él
  p.coughIn = 0;
  for (let i = 0; i < TICK_RATE && p.alive; i++) room.tick();
  assert.equal(p.alive, false);
});

test('se le puede despistar doblando una esquina', () => {
  let escapes = 0;
  for (let trial = 0; trial < 5; trial++) {
    const room = new Room('TEST', () => {});
    clearInterval(room.interval);
    room.addPlayer('1', 'Ana', () => {});
    room.startRound();
    const p = room.players.get('1');
    p.coughIn = 999;
    const m = room.monster;
    Object.assign(m, { x: 43, z: 18.5, yaw: -Math.PI / 2, state: 'patrol', path: [] });
    room.startChase(p);
    // Ana huye corriendo 11 m por delante, gira por un pasillo y luego por otro
    const route = [[24, 18.5], [24, 8.2], [4, 8.2], [4, 3]];
    let pos = [32, 18.5], wi = 0;
    for (let i = 0; i < 30 * TICK_RATE && p.alive; i++) {
      const tgt = route[wi];
      if (tgt) {
        const dx = tgt[0] - pos[0], dz = tgt[1] - pos[1], d = Math.hypot(dx, dz);
        const step = (i < 6 * TICK_RATE ? 6.5 : 3.5) / TICK_RATE;
        if (d <= step) { pos = [...tgt]; wi++; } else pos = [pos[0] + (dx / d) * step, pos[1] + (dz / d) * step];
      }
      room.handle('1', {
        t: 'state', p: [pos[0], 0, pos[1]], yaw: tgt ? Math.atan2(tgt[0] - pos[0], tgt[1] - pos[1]) : 0,
        noise: tgt ? (i < 6 * TICK_RATE ? 16 : 7) : 0, crouch: false, light: true,
      });
      room.tick();
    }
    if (p.alive) escapes++;
  }
  assert.ok(escapes >= 3, `solo escapó ${escapes} de 5`);
});

test('siempre hay productos para toda la lista', () => {
  for (let i = 0; i < 200; i++) {
    const room = new Room('TEST', () => {});
    clearInterval(room.interval);
    room.addPlayer('1', 'Ana', () => {});
    room.startRound();
    assert.equal(room.items.length, 8);
    assert.ok(room.items.every((it) => Number.isFinite(it.x)));
  }
});

test('la cena: comer leyendo, disparo si mira y ranking', () => {
  const room = new Room('TEST', () => {});
  clearInterval(room.interval);
  const inbox = [];
  room.addPlayer('1', 'Ana', (m) => inbox.push(m));
  room.addPlayer('2', 'Beto', () => {});
  room.handle('1', { t: 'mode', mode: 'dinner' });
  room.handle('1', { t: 'start' });
  const d = room.dinner;
  assert.ok(d);
  const ana = d.players.get('1'), beto = d.players.get('2');
  const tick = (s) => { for (let i = 0; i < s * TICK_RATE; i++) room.tick(); };

  // Mientras lee, Ana se come todo el plato a tandas
  d.sentinel.timer = 999;
  while (ana.peas > 0) {
    for (let i = 0; i < 10; i++) { room.handle('1', { t: 'load' }); tick(0.15); }
    room.handle('1', { t: 'eat' });
    tick(2);
  }
  assert.equal(ana.place, 1);

  // Beto carga el tenedor y el centinela baja el periódico: disparo
  room.handle('2', { t: 'load' });
  d.setSentinel('watching', 2);
  d.sentinel.duration = 2;
  tick(1);
  assert.equal(beto.alive, false);
  assert.ok(inbox.some((m) => m.t === 'shot' && m.id === '2'));
  const end = inbox.find((m) => m.t === 'end');
  assert.equal(end.result, 'dinner');
  assert.deepEqual(end.ranking.map((r) => r.name), ['Ana', 'Beto']);
});
