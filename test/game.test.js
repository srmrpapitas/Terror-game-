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
  // El jugador huye por el pasillo central, siempre 7 m por delante
  for (let i = 0; i < 8 * TICK_RATE; i++) {
    room.handle('1', { t: 'state', p: [Math.min(56, m.x + 7), 0, 18.5], yaw: 0, noise: 14, crouch: false, light: true });
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
