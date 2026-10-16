// Sonidos generados con Web Audio (sin archivos): pasos en 3D, respiración y rugido
// del monstruo, zumbido de fluorescentes, latido y el chillido del susto.

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
  }

  // Los navegadores (sobre todo en móvil) solo permiten audio tras un toque o clic.
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.noise = this.makeNoise(2);
      this.startHum();
      this.startBreathing();
      this.ready = true;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  makeNoise(seconds) {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // `life` en segundos: se desconecta solo para no acumular nodos.
  panner(x, y, z, ref = 2, rolloff = 1.4, life = 0) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = 60;
    p.rolloffFactor = rolloff;
    setPos(p, x, y, z, this.ctx.currentTime);
    p.connect(this.master);
    if (life) setTimeout(() => p.disconnect(), life * 1000);
    return p;
  }

  updateListener(camera) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    const e = camera.matrixWorld.elements;
    const pos = [e[12], e[13], e[14]];
    const fwd = [-e[8], -e[9], -e[10]];
    const up = [e[4], e[5], e[6]];
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos[0], t, 0.02);
      l.positionY.setTargetAtTime(pos[1], t, 0.02);
      l.positionZ.setTargetAtTime(pos[2], t, 0.02);
      l.forwardX.setTargetAtTime(fwd[0], t, 0.02);
      l.forwardY.setTargetAtTime(fwd[1], t, 0.02);
      l.forwardZ.setTargetAtTime(fwd[2], t, 0.02);
      l.upX.setTargetAtTime(up[0], t, 0.02);
      l.upY.setTargetAtTime(up[1], t, 0.02);
      l.upZ.setTargetAtTime(up[2], t, 0.02);
    } else {
      l.setPosition(...pos);
      l.setOrientation(...fwd, ...up);
    }
  }

  // ---- La Cena ----

  // Ruido de periódico: ráfagas cortas de ruido agudo (más fuertes al bajarlo).
  paper(volume = 0.3) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.05 + Math.random() * 0.08);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1800 + Math.random() * 2500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(volume * (0.5 + Math.random() * 0.5), t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06 + Math.random() * 0.08);
      src.connect(f).connect(g).connect(this.master);
      src.start(t, Math.random() * 1.5, 0.2);
    }
  }

  // Disparo: golpe seco muy fuerte con cola grave.
  gunshot(volume = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(1.6 * volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(120);
    src.connect(shaper).connect(g).connect(this.master);
    src.start(t, 0, 0.6);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    const og = ctx.createGain();
    og.gain.setValueAtTime(1.4 * volume, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.55);
  }

  // Masticar: unos golpecitos sordos.
  chew() {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = t0 + 0.12 + i * 0.16;
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.06);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  // Tic-tac del reloj del comedor.
  tick(high) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = high ? 2600 : 2100;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.025, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.04);
  }

  // Tos: dos o tres golpes de ruido filtrado con una vocal grave. `pos` null = la tuya.
  cough(pos) {
    if (!this.ready) return;
    const out = pos ? this.panner(pos.x, pos.y, pos.z, 2, 1.2, 2) : this.master;
    const t0 = this.ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.28 + Math.random() * 0.08);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 700 + Math.random() * 300;
      f.Q.value = 1.2;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(pos ? 0.9 : 0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      src.connect(f).connect(g).connect(out);
      src.start(t, Math.random());
      src.stop(t + 0.25);
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
      const og = this.ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(pos ? 0.2 : 0.1, t + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + 0.2);
    }
  }

  // Traqueteo del carrito: ruido metálico filtrado que sube con la velocidad,
  // con algún golpe suelto de la rejilla. `speed` en m/s.
  cartRattle(speed, careful = false) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (!this.cart) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const band = this.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2600;
      band.Q.value = 2.5;
      const rumble = this.ctx.createBiquadFilter();
      rumble.type = 'lowpass';
      rumble.frequency.value = 180;
      const gHi = this.ctx.createGain();
      const gLo = this.ctx.createGain();
      gHi.gain.value = gLo.gain.value = 0;
      src.connect(band).connect(gHi).connect(this.master);
      src.connect(rumble).connect(gLo).connect(this.master);
      src.start();
      this.cart = { gHi, gLo, band };
    }
    const k = Math.min(1, speed / 6) * (careful ? 0.4 : 1);
    const jitter = 0.7 + Math.random() * 0.6;
    this.cart.gHi.gain.setTargetAtTime(k * 0.07 * jitter, t, 0.05);
    this.cart.gLo.gain.setTargetAtTime(k * 0.5, t, 0.08);
    this.cart.band.frequency.setTargetAtTime(2200 + Math.random() * 1200, t, 0.05);
    // Golpe de rejilla de vez en cuando
    if (speed > 1 && Math.random() < 0.012 * (careful ? 0.3 : 1) * speed) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 900 + Math.random() * 900;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.05 * k, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.08);
    }
  }

  // Un paso: golpe grave + roce. `pos` null = tus propios pasos (sin posición).
  footstep(pos, { volume = 0.5, heavy = false } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = pos ? this.panner(pos.x, 0.1, pos.z, heavy ? 4 : 1.5, 1.4, 1) : this.master;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = heavy ? 0.5 : 0.9 + Math.random() * 0.3;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = heavy ? 220 : 900 + Math.random() * 400;
    filt.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + (heavy ? 0.35 : 0.14));
    src.connect(filt).connect(g).connect(out);
    src.start(t, Math.random() * 1.5, 0.4);

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(heavy ? 70 : 140, t);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 35 : 60, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(volume * (heavy ? 1.6 : 0.5), t);
    og.gain.exponentialRampToValueAtTime(0.001, t + (heavy ? 0.3 : 0.1));
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.35);
  }

  startHum() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 100;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 400;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0.012;
    osc.connect(filt).connect(this.humGain).connect(this.master);
    osc.start();
  }

  // Corta el zumbido un momento (cuando las luces parpadean).
  flickerHum(off) {
    if (!this.ready) return;
    this.humGain.gain.setTargetAtTime(off ? 0 : 0.012, this.ctx.currentTime, 0.01);
  }

  // Respiración del monstruo: ruido filtrado que sube y baja, colocado en su posición.
  startBreathing() {
    const ctx = this.ctx;
    this.monsterPanner = this.panner(0, 2.2, 0, 3, 1.2);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 350;
    filt.Q.value = 2;
    const growl = ctx.createOscillator();
    growl.type = 'sawtooth';
    growl.frequency.value = 48;
    const growlGain = ctx.createGain();
    growlGain.gain.value = 0.25;
    this.breathGain = ctx.createGain();
    this.breathGain.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.45;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    const env = ctx.createGain();
    env.gain.value = 0.5;
    lfo.connect(lfoGain).connect(env.gain);
    src.connect(filt).connect(env);
    growl.connect(growlGain).connect(env);
    env.connect(this.breathGain).connect(this.monsterPanner);
    src.start();
    growl.start();
    lfo.start();
    this.breathLfo = lfo;
  }

  updateMonster(x, z, state, visible) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    setPos(this.monsterPanner, x, 2.2, z, t);
    const chasing = state === 'chase';
    this.breathGain.gain.setTargetAtTime(visible ? (chasing ? 0.9 : 0.5) : 0, t, 0.2);
    this.breathLfo.frequency.setTargetAtTime(chasing ? 1.6 : 0.45, t, 0.3);
  }

  roar(x, z) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this.panner(x, 2.2, z, 6, 0.8, 2.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.2, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(80);
    shaper.connect(g).connect(out);
    for (const f of [62, 93, 131]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 1.4, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 1.5);
      o.connect(shaper);
      o.start(t);
      o.stop(t + 1.9);
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 900;
    n.connect(nf).connect(shaper);
    n.start(t, 0, 1.9);
  }

  // El susto: chillido fuerte, distorsionado y sin posición (directo a la cara).
  scream() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(2.2, t + 0.03);
    g.gain.setValueAtTime(2.2, t + 1.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(300);
    shaper.connect(g).connect(this.master);
    for (const [f0, f1] of [[880, 1500], [660, 1300], [440, 210], [120, 60]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + 2.4);
      const vib = ctx.createOscillator();
      vib.frequency.value = 11;
      const vg = ctx.createGain();
      vg.gain.value = f0 * 0.06;
      vib.connect(vg).connect(o.frequency);
      o.connect(shaper);
      o.start(t); vib.start(t);
      o.stop(t + 2.7); vib.stop(t + 2.7);
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.connect(shaper);
    n.start(t, 0, 2.6);
  }

  // Grito lejano cuando el monstruo atrapa a otro jugador.
  distantScream(x, z) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this.panner(x, 1.6, z, 8, 0.6, 2);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(700, t);
    o.frequency.exponentialRampToValueAtTime(380, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 1.4);
  }

  heartbeat(volume) {
    if (!this.ready || volume <= 0) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [dt, v] of [[0, 1], [0.16, 0.7]]) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(60, t + dt);
      o.frequency.exponentialRampToValueAtTime(35, t + dt + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(volume * v, t + dt);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.15);
      o.connect(g).connect(this.master);
      o.start(t + dt);
      o.stop(t + dt + 0.2);
    }
  }

  pickup() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, dt] of [[660, 0], [990, 0.08]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.15, t + dt);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.25);
      o.connect(g).connect(this.master);
      o.start(t + dt);
      o.stop(t + dt + 0.3);
    }
  }

  // Golpe seco para los sustos pequeños (una lata que cae, un carrito).
  clatter(x, z) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this.panner(x, 0.5, z, 2, 1, 1.5);
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 1800 + Math.random() * 1500;
      const g = ctx.createGain();
      const s = t + i * (0.09 + Math.random() * 0.08);
      g.gain.setValueAtTime(0.25 / (i + 1), s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.12);
      o.connect(g).connect(out);
      o.start(s);
      o.stop(s + 0.15);
    }
  }
}

function setPos(p, x, y, z, t) {
  if (p.positionX) {
    p.positionX.setTargetAtTime(x, t, 0.03);
    p.positionY.setTargetAtTime(y, t, 0.03);
    p.positionZ.setTargetAtTime(z, t, 0.03);
  } else {
    p.setPosition(x, y, z);
  }
}

function distortionCurve(amount) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}
