// Modo "La Cena": los jugadores comen guisantes delante del centinela, que lee el
// periódico. Si lo baja y te pilla comiendo o con el tenedor cargado, te dispara.
// El servidor es el árbitro: decide cuándo baja el periódico y a quién pilla.
import { DINNER } from '../shared/constants.js';

export class Dinner {
  constructor(room) {
    this.room = room;
    this.sentinel = { state: 'reading', timer: rand(DINNER.firstRead), fake: false };
    this.finished = 0; // cuántos han terminado el plato
    this.deaths = 0;
    this.seats = new Map(); // id -> asiento
    this.players = new Map(); // id -> estado en la mesa
    let seat = 0;
    for (const p of room.players.values()) {
      this.seats.set(p.id, seat++);
      this.players.set(p.id, newDiner());
    }
  }

  // Quien entra a mitad de cena mira desde fuera
  addSpectator(id) {
    this.players.set(id, { ...newDiner(), alive: false, peas: 0 });
  }

  remove(id) {
    this.players.delete(id);
    this.seats.delete(id);
  }

  handle(id, msg) {
    const d = this.players.get(id);
    if (!d || !d.alive || d.place) return;
    switch (msg.t) {
      case 'load':
        // Un guisante cada vez, sin pasarse de los que quedan en el plato
        if (d.eating > 0 || d.cooldown > 0 || d.fork >= d.peas) return;
        d.fork++;
        d.cooldown = DINNER.loadInterval;
        break;
      case 'eat':
        if (d.eating > 0 || d.fork === 0) return;
        d.eating = DINNER.eatBase + DINNER.eatPerPea * d.fork;
        break;
      case 'drop':
        // Devuelve los guisantes al plato (rápido, pero no instantáneo)
        if (d.eating > 0 || d.fork === 0) return;
        d.fork = 0;
        d.cooldown = DINNER.dropTime;
        break;
    }
  }

  tick(dt) {
    for (const [id, d] of this.players) {
      d.cooldown = Math.max(0, d.cooldown - dt);
      if (d.eating > 0) {
        d.eating -= dt;
        if (d.eating <= 0) {
          d.eating = 0;
          d.peas -= d.fork;
          d.fork = 0;
          if (d.peas <= 0 && d.alive) {
            d.place = ++this.finished;
            const p = this.room.players.get(id);
            this.room.broadcast({ t: 'cleaned', id, name: p?.name, place: d.place });
          }
        }
      }
    }

    const s = this.sentinel;
    s.timer -= dt;
    if (s.state === 'watching') {
      // Un pequeño margen al empezar a mirar compensa el retraso de la red
      if (s.timer < s.duration - DINNER.grace) {
        for (const [id, d] of this.players) {
          if (d.alive && !d.place && (d.fork > 0 || d.eating > 0)) this.shoot(id);
        }
      }
    }
    if (s.timer > 0) return;
    if (s.state === 'reading') {
      // A veces solo pasa la página: hace ruido pero no baja el periódico
      s.fake = Math.random() < DINNER.fakeChance;
      this.setSentinel('warning', rand(DINNER.warning));
    } else if (s.state === 'warning') {
      if (s.fake) this.setSentinel('reading', rand(DINNER.read));
      else {
        const t = rand(DINNER.watch);
        this.setSentinel('watching', t);
        s.duration = t;
      }
    } else {
      this.setSentinel('reading', rand(DINNER.read));
    }
  }

  setSentinel(state, timer) {
    this.sentinel.state = state;
    this.sentinel.timer = timer;
  }

  shoot(id) {
    const d = this.players.get(id);
    d.alive = false;
    d.fork = 0;
    d.eating = 0;
    d.death = ++this.deaths;
    const p = this.room.players.get(id);
    if (p) p.alive = false;
    this.room.broadcast({ t: 'shot', id, name: p?.name });
  }

  // Termina cuando nadie sigue comiendo.
  over() {
    return ![...this.players.values()].some((d) => d.alive && !d.place);
  }

  // Primero los que limpiaron el plato (por orden) y luego los muertos: quien
  // aguantó más queda por delante.
  ranking() {
    const rows = [...this.players].map(([id, d]) => ({
      id, name: this.room.players.get(id)?.name ?? '?', place: d.place, death: d.death, left: d.peas,
    }));
    rows.sort((a, b) => {
      if (a.place && b.place) return a.place - b.place;
      if (a.place || b.place) return a.place ? -1 : 1;
      return (b.death || 0) - (a.death || 0);
    });
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  snapshot() {
    return {
      s: this.sentinel.state,
      players: [...this.players].map(([id, d]) => ({
        id, seat: this.seats.get(id) ?? -1, peas: d.peas, fork: d.fork,
        eating: d.eating > 0, alive: d.alive, place: d.place,
      })),
    };
  }
}

function newDiner() {
  return { peas: DINNER.peas, fork: 0, eating: 0, cooldown: 0, alive: true, place: 0, death: 0 };
}

function rand([a, b]) {
  return a + Math.random() * (b - a);
}
