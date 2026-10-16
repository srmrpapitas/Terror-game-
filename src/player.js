// Jugador local: controles de teclado/ratón y táctiles, movimiento con colisiones,
// estamina, linterna y pasos.
import * as THREE from 'three';
import { resolveCircle, SPAWN } from '../shared/map.js';
import { PLAYER } from '../shared/constants.js';

export class LocalPlayer {
  constructor(camera, canvas, isTouch) {
    this.camera = camera;
    this.canvas = canvas;
    this.isTouch = isTouch;
    this.pos = new THREE.Vector3(SPAWN.x, 0, SPAWN.z);
    this.yaw = 0; // con yaw 0 la cámara mira hacia -z (el fondo de la tienda)
    this.pitch = 0;
    this.eye = PLAYER.eyeHeight;
    this.stamina = 1;
    this.crouch = false;
    this.light = true;
    this.mode = 'idle'; // idle | crouch | walk | run
    this.alive = true;
    this.frozen = true; // sin control (menú, susto)
    this.stepDist = 0;
    this.bob = 0;
    this.keys = new Set();
    this.touchMove = { x: 0, y: 0 };
    this.touchRun = false;
    this.onStep = null;
    this.onUse = null;

    this.flashlight = new THREE.SpotLight(0xfff2d8, 30, 22, 0.42, 0.45, 1.5);
    this.flashlight.position.set(0.15, -0.2, 0);
    this.flashlight.target.position.set(0, -0.3, -3);
    camera.add(this.flashlight, this.flashlight.target);

    this.bindDesktop();
  }

  bindDesktop() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.frozen) return;
      if (e.code === 'KeyC' || e.code === 'ControlLeft') this.crouch = !this.crouch;
      if (e.code === 'KeyF') this.toggleLight();
      if (e.code === 'KeyE') this.onUse?.();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas || this.frozen) return;
      this.look(e.movementX * 0.0022, e.movementY * 0.0022);
    });
  }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - dy));
  }

  toggleLight() {
    this.light = !this.light;
  }

  // Orientación en el convenio del servidor (0 = mirando a +z)
  get facing() {
    return this.yaw + Math.PI;
  }

  update(dt) {
    let fx = 0, fz = 0, wantRun = false;
    if (!this.frozen) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1;
      fx += this.touchMove.x;
      fz += this.touchMove.y;
      wantRun = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchRun;
    }
    let len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; len = 1; }

    const moving = len > 0.1;
    const canRun = wantRun && moving && this.stamina > 0.02 && !this.crouch && this.alive;
    if (canRun) {
      this.stamina = Math.max(0, this.stamina - dt / PLAYER.staminaSeconds);
    } else {
      this.stamina = Math.min(1, this.stamina + dt * PLAYER.staminaRegen);
    }
    this.mode = !moving ? 'idle' : this.crouch ? 'crouch' : canRun ? 'run' : 'walk';
    const speed = moving ? PLAYER.speed[this.mode] * Math.min(1, len) : 0;

    // Movimiento relativo a la cámara
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const dx = (fx * cos - fz * sin) * speed * dt;
    const dz = (-fx * sin - fz * cos) * speed * dt;
    const fixed = resolveCircle(this.pos.x + dx, this.pos.z + dz, PLAYER.radius);
    const moved = Math.hypot(fixed.x - this.pos.x, fixed.z - this.pos.z);
    this.pos.x = fixed.x;
    this.pos.z = fixed.z;

    // Pasos y balanceo de cabeza
    const stride = this.mode === 'run' ? 2.1 : this.mode === 'crouch' ? 0.9 : 1.5;
    this.stepDist += moved;
    if (this.stepDist > stride) {
      this.stepDist = 0;
      if (this.alive) this.onStep?.(this.mode);
    }
    this.bob += moved * (this.mode === 'run' ? 3.2 : 4);

    const targetEye = this.crouch ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 10);
    const bobAmt = this.mode === 'run' ? 0.07 : this.mode === 'walk' ? 0.035 : 0.015;
    this.camera.position.set(this.pos.x, this.eye + Math.sin(this.bob) * bobAmt, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bob * 0.5) * bobAmt * 0.3, 'YXZ');

    // Linterna: parpadea un poco al quedarse sin estamina
    const flick = this.stamina < 0.15 ? 0.85 + Math.random() * 0.15 : 1;
    this.flashlight.intensity = this.light && this.alive ? 30 * flick : 0;
  }

  get noise() {
    if (!this.alive) return 0;
    return PLAYER.noise[this.mode] ?? 0;
  }

  // ---- Controles táctiles ----
  bindTouch({ stick, knob, lookZone, runBtn, crouchBtn, lightBtn, useBtn }) {
    let stickId = null, lookId = null, lastX = 0, lastY = 0, cx = 0, cy = 0;
    const R = 55;
    stick.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      stickId = t.identifier;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      moveStick(t);
      e.preventDefault();
    }, { passive: false });
    const moveStick = (t) => {
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touchMove.x = dx / R;
      this.touchMove.y = -dy / R;
      // Empujar el joystick hasta el borde también hace correr
      this.touchRun = runBtn.classList.contains('on') || d > R * 1.25;
    };
    lookZone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      lookId = t.identifier;
      lastX = t.clientX;
      lastY = t.clientY;
      e.preventDefault();
    }, { passive: false });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) moveStick(t);
        if (t.identifier === lookId && !this.frozen) {
          this.look((t.clientX - lastX) * 0.0055, (t.clientY - lastY) * 0.0055);
          lastX = t.clientX;
          lastY = t.clientY;
        }
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          stickId = null;
          knob.style.transform = '';
          this.touchMove.x = this.touchMove.y = 0;
          this.touchRun = runBtn.classList.contains('on');
        }
        if (t.identifier === lookId) lookId = null;
      }
    };
    addEventListener('touchend', end);
    addEventListener('touchcancel', end);

    const tap = (btn, fn) => btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.frozen) fn();
    }, { passive: false });
    tap(runBtn, () => {
      runBtn.classList.toggle('on');
      this.touchRun = runBtn.classList.contains('on');
      if (this.touchRun && this.crouch) { this.crouch = false; crouchBtn.classList.remove('on'); }
    });
    tap(crouchBtn, () => {
      this.crouch = !this.crouch;
      crouchBtn.classList.toggle('on', this.crouch);
      if (this.crouch) { runBtn.classList.remove('on'); this.touchRun = false; }
    });
    tap(lightBtn, () => {
      this.toggleLight();
      lightBtn.classList.toggle('on', this.light);
    });
    tap(useBtn, () => this.onUse?.());
    lightBtn.classList.toggle('on', this.light);
  }
}
