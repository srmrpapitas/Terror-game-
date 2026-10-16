// Representación del monstruo en el cliente: carga el FBX de Mixamo, lo escala
// y lo mueve hacia la posición que manda el servidor.
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MONSTER } from '../shared/constants.js';

export class MonsterView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.target = new THREE.Vector3();
    this.targetYaw = 0;
    this.state = 'idle';
    this.mixer = null;
    this.action = null;
    this.clips = {};
    this.head = null;
    this.feet = []; // huesos de los pies, para apoyarlo en el suelo
    this.groundY = 0;
    this.has = false; // ya llegó al menos una posición
    this.stepDist = 0;
    this.lastPos = new THREE.Vector3();

    // Ojos rojos (siempre visibles un poco a través de la niebla)
    this.eyes = new THREE.Group();
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff1a1a, fog: false });
    for (const x of [-0.09, 0.09]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), eyeMat);
      eye.position.set(x, 0, 0);
      this.eyes.add(eye);
    }
    this.faceLight = new THREE.PointLight(0xff2020, 0, 0.7, 2);
    this.eyes.add(this.faceLight);

    this.placeholder = buildPlaceholder();
    this.root.add(this.placeholder);
    this.placeholder.add(this.eyes);
    this.eyes.position.set(0, 2.35, 0.3);
  }

  load(url, onDone) {
    new FBXLoader().load(
      url,
      (fbx) => {
        const box = new THREE.Box3().setFromObject(fbx);
        const h = box.max.y - box.min.y || 1;
        const s = MONSTER.height / h;
        fbx.scale.setScalar(s);
        fbx.position.y = this.groundY = -box.min.y * s;
        fbx.traverse((o) => {
          if (o.isMesh) {
            o.frustumCulled = false; // los huesos mueven la malla fuera de su caja original
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              m.fog = true;
              if (m.shininess !== undefined) m.shininess = 8;
              // Un brillo neutro muy tenue para que su silueta se intuya en la oscuridad, sin teñirlo
              if (m.emissive) m.emissive.setHex(0x0c0c0c);
            }
          }
          if (o.isBone && /head$/i.test(o.name) && !this.head) this.head = o;
          if (o.isBone && /(foot|toebase)$/i.test(o.name)) this.feet.push(o);
        });
        this.root.remove(this.placeholder);
        this.root.add(fbx);
        this.model = fbx;
        // Ojos rojos que brillan en la oscuridad, pegados a la cabeza del esqueleto.
        // Se colocan en coordenadas del mundo y se pasan al espacio del hueso.
        fbx.updateMatrixWorld(true);
        const parent = this.head || fbx;
        const headPos = new THREE.Vector3();
        if (this.head) this.head.getWorldPosition(headPos);
        else headPos.set(0, MONSTER.height * 0.88, 0);
        parent.add(this.eyes);
        const local = parent.worldToLocal(headPos.clone().add(new THREE.Vector3(0, 0.06, 0.2)));
        this.eyes.position.copy(local);
        const ws = new THREE.Vector3();
        parent.getWorldScale(ws);
        this.eyes.scale.setScalar(1 / ws.x);
        // Que miren hacia donde mira el monstruo, sea cual sea el giro del hueso
        const pq = new THREE.Quaternion();
        parent.getWorldQuaternion(pq);
        this.eyes.quaternion.copy(pq.invert());
        this.mixer = new THREE.AnimationMixer(fbx);
        if (fbx.animations.length) this.addClip('base', fbx.animations[0]);
        this.loadAnimations();
        onDone?.(true);
      },
      undefined,
      (err) => {
        console.warn('No se pudo cargar el monstruo, uso la figura provisional', err);
        onDone?.(false);
      },
    );
  }

  // Animaciones opcionales de Mixamo (descargadas "Without Skin"). Si un archivo
  // no existe se ignora y el monstruo usa la que tenga.
  loadAnimations() {
    const loader = new FBXLoader();
    for (const name of ['walk', 'run', 'idle', 'turn', 'scream']) {
      loader.load(`/models/warrok-${name}.fbx`, (anim) => {
        if (anim.animations.length) this.addClip(name, anim.animations[0]);
      }, undefined, () => {});
    }
  }

  addClip(name, clip) {
    // Las animaciones de Mixamo sin "In Place" desplazan la cadera: se deja solo el
    // movimiento vertical para que el servidor sea quien mueve al monstruo
    for (const t of clip.tracks) {
      if (!/Hips\.position$/.test(t.name)) continue;
      const v = t.values;
      for (let i = 0; i < v.length; i += 3) {
        v[i] = v[0];
        v[i + 2] = v[2];
      }
    }
    this.clips[name] = this.mixer.clipAction(clip);
    this.playFor(this.state, true);
  }

  // Elige la animación según lo que esté haciendo.
  playFor(state, force = false) {
    if (!this.mixer) return;
    const want = { chase: 'run', patrol: 'walk', investigate: 'walk', scan: 'turn', scare: 'scream', notice: 'scream' }[state] || 'idle';
    if (want === 'turn' && !this.clips.turn) return this.playFor('idle', force);
    const action = this.clips[want] || this.clips.walk || this.clips.base;
    if (!action || (action === this.action && !force)) return;
    action.reset().play();
    if (this.action && this.action !== action) this.action.crossFadeTo(action, 0.25, false);
    this.action = action;
  }

  // Datos del servidor: posición, orientación y estado.
  setNet(m) {
    this.target.set(m.p[0], 0, m.p[1]);
    this.targetYaw = m.yaw;
    this.anger = m.anger || 0;
    if (m.state !== this.state) {
      this.state = m.state;
      this.playFor(this.state);
    }
    if (!this.has) {
      this.root.position.copy(this.target);
      this.root.rotation.y = this.targetYaw;
      this.lastPos.copy(this.target);
      this.has = true;
    }
    this.root.visible = true;
  }

  hide() {
    this.root.visible = false;
    this.has = false;
  }

  // Devuelve los metros recorridos este frame (para los pasos).
  update(dt, time) {
    if (!this.has) return 0;
    const k = 1 - Math.exp(-dt * 12);
    this.root.position.lerp(this.target, k);
    let d = this.targetYaw - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * k;

    const moved = this.root.position.distanceTo(this.lastPos);
    this.lastPos.copy(this.root.position);
    const speed = moved / Math.max(dt, 1e-3);

    if (this.mixer) {
      // Sin animación de correr, acelera la de andar
      const rage = 1 + 0.3 * (this.anger || 0);
      if (this.action && this.state === 'chase' && !this.clips.run) this.action.timeScale = 1.8 * rage;
      else if (this.action) this.action.timeScale = rage;
      this.mixer.update(dt);
      this.groundFeet(dt);
    }
    // Balanceo al andar para que no parezca que se desliza
    const body = this.model || this.placeholder;
    body.rotation.z = Math.sin(time * (speed > 5 ? 9 : 4)) * Math.min(0.06, speed * 0.008);
    // Halo rojo alrededor del monstruo: avisa de que está cerca aunque no lo mires
    // Más rabia (más productos cogidos) = ojos más encendidos
    const eyeGlow = (this.state === 'chase' ? 6 : 3) * (1 + (this.anger || 0));
    this.faceLight.intensity = eyeGlow * (0.8 + Math.sin(time * 20) * 0.2);
    return moved;
  }

  // Las animaciones de Mixamo no siempre dejan los pies a la altura del suelo (y el
  // monstruo parece flotar): se baja o sube el modelo para que el pie más bajo toque el suelo.
  groundFeet(dt) {
    if (!this.model || !this.feet.length) return;
    this.model.updateMatrixWorld(true);
    let low = Infinity;
    const v = new THREE.Vector3();
    for (const b of this.feet) low = Math.min(low, b.getWorldPosition(v).y);
    // El hueso está dentro del pie: unos centímetros por encima de la suela
    const err = low - this.root.position.y - 0.08;
    const k = 1 - Math.exp(-dt * 10);
    this.model.position.y -= err * k;
  }

  headWorldPosition(out) {
    return this.eyes.getWorldPosition(out);
  }
}

// Figura provisional mientras carga el modelo (o si falla).
function buildPlaceholder() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x1a1412 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.3, 4, 8), mat);
  body.position.y = 1.4;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 10), mat);
  head.position.y = 2.35;
  g.add(head);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 1.3, 4, 6), mat);
    arm.position.set(side * 0.6, 1.3, 0.1);
    arm.rotation.z = side * 0.15;
    g.add(arm);
  }
  return g;
}
