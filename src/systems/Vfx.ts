// Spell VFX: one pooled additive particle system plus short-lived authored meshes (projectiles, shields, roots, bolts).
import * as THREE from 'three';

const MAX_PARTICLES = 3000;

interface Emit {
  pos: THREE.Vector3; count: number; color: THREE.ColorRepresentation; speed?: number; up?: number; spread?: number;
  life?: number; size?: number; gravity?: number; drag?: number; dir?: THREE.Vector3; jitter?: number;
}

/** A live effect updated every frame until it returns false. */
type Effect = (dt: number) => boolean;

export class Vfx {
  readonly group = new THREE.Group();
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos = new Float32Array(MAX_PARTICLES * 3);
  private readonly col = new Float32Array(MAX_PARTICLES * 3);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly alpha = new Float32Array(MAX_PARTICLES);
  private readonly vel = new Float32Array(MAX_PARTICLES * 3);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly grav = new Float32Array(MAX_PARTICLES);
  private readonly drag = new Float32Array(MAX_PARTICLES);
  private readonly size0 = new Float32Array(MAX_PARTICLES);
  private next = 0;
  private effects: Effect[] = [];
  private readonly c = new THREE.Color();
  private readonly v = new THREE.Vector3();
  private readonly rng: () => number;
  // shared assets
  private readonly rockGeo = new THREE.DodecahedronGeometry(0.42, 0);
  private readonly rockMat = new THREE.MeshStandardMaterial({ color: '#8a7a62', roughness: 0.95, flatShading: true });
  private readonly glowTex = glowTexture();
  // a fixed pool of flash lights: adding/removing lights would recompile every lit shader mid-fight
  private readonly lights = Array.from({ length: 3 }, () => new THREE.PointLight('#ffffff', 0, 10, 2));
  private nextLight = 0;
  private clock = 0;

  constructor(scene: THREE.Scene, rng: () => number) {
    this.rng = rng;
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const points = new THREE.Points(this.geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      uniforms: { uScale: { value: 300 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; varying vec3 vColor; varying float vAlpha; uniform float uScale;
        void main() { vColor = color; vAlpha = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vColor; varying float vAlpha;
        void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
          gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.0, d)); }`,
    }));
    points.frustumCulled = false;
    this.group.add(points, ...this.lights);
    scene.add(this.group);
  }

  private rand(a = -1, b = 1) { return a + this.rng() * (b - a); }

  emit(o: Emit): void {
    this.c.set(o.color);
    for (let n = 0; n < o.count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_PARTICLES;
      const j = o.jitter ?? 0.1;
      this.pos.set([o.pos.x + this.rand() * j, o.pos.y + this.rand() * j, o.pos.z + this.rand() * j], i * 3);
      const s = (o.speed ?? 2) * (0.4 + this.rng() * 0.8), spread = o.spread ?? 1;
      this.v.set(this.rand() * spread, this.rand() * spread + (o.up ?? 0), this.rand() * spread).normalize().multiplyScalar(s);
      if (o.dir) this.v.add(o.dir);
      this.vel.set([this.v.x, this.v.y, this.v.z], i * 3);
      this.col.set([this.c.r, this.c.g, this.c.b], i * 3);
      this.maxLife[i] = this.life[i] = (o.life ?? 0.7) * (0.6 + this.rng() * 0.6);
      this.size0[i] = (o.size ?? 0.25) * (0.6 + this.rng() * 0.8);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1.5;
    }
  }

  /** Borrows a pooled light; returns it so a moving effect can follow it. */
  private flashLight(at: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, seconds: number, range = 10): THREE.PointLight {
    const light = this.lights[this.nextLight];
    this.nextLight = (this.nextLight + 1) % this.lights.length;
    light.color.set(color);
    light.distance = range;
    light.position.copy(at);
    light.intensity = intensity;
    let t = 0;
    const owner = {};
    (light.userData as { owner?: object }).owner = owner;
    this.add(dt => {
      if ((light.userData as { owner?: object }).owner !== owner) return false; // re-borrowed
      t += dt;
      light.intensity = dt === Infinity ? 0 : intensity * Math.max(0, 1 - t / seconds);
      return t < seconds;
    });
    return light;
  }

  update(dt: number): void {
    this.clock += dt;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]), d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = Math.min(1, k * 2.2);
      this.size[i] = this.size0[i] * (0.4 + k * 0.6);
    }
    for (const name of ['position', 'aAlpha', 'aSize', 'color']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    // effects may spawn effects (an orb's impact burst); collect those separately so none are dropped
    const running = this.effects;
    this.effects = [];
    const kept = running.filter(e => e(dt));
    this.effects = kept.concat(this.effects);
  }

  clear(): void {
    this.life.fill(0);
    for (const e of this.effects) e(Infinity); // effects remove their meshes when given an infinite step
    this.effects = [];
  }

  private add(effect: Effect) { this.effects.push(effect); }

  private temp(obj: THREE.Object3D, lifetime: number, tick: (k: number, dt: number) => void, onEnd?: () => void): void {
    this.group.add(obj);
    let t = 0;
    this.add(dt => {
      t += dt;
      const k = Math.min(1, t / lifetime);
      if (dt !== Infinity) tick(k, dt);
      if (k >= 1 || dt === Infinity) {
        this.discard(obj);
        if (dt !== Infinity) onEnd?.();
        return false;
      }
      return true;
    });
  }

  private discard(obj: THREE.Object3D): void {
    this.group.remove(obj);
    obj.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry && m.geometry !== this.rockGeo && !(o as THREE.Sprite).isSprite) m.geometry.dispose();
      if (m.material && m.material !== this.rockMat) (m.material as THREE.Material).dispose();
    });
  }

  private glow(color: THREE.ColorRepresentation, scale: number): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(scale);
    return s;
  }

  burst(at: THREE.Vector3, color: THREE.ColorRepresentation, count = 60, speed = 5): void {
    this.emit({ pos: at, count, color, speed, life: 0.6, size: 0.35, drag: 3, up: 0.3 });
    const flash = this.glow(color, 1.8);
    flash.position.copy(at);
    this.flashLight(at, color, 25, 0.35, 9);
    this.temp(flash, 0.3, k => { flash.material.opacity = 0.8 * (1 - k); flash.scale.setScalar(1.8 + k * 1.4); });
  }

  ring(at: THREE.Vector3, color: THREE.ColorRepresentation, radius = 3): void {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(at.x, 0.12, at.z);
    this.temp(m, 0.55, k => { m.scale.setScalar(0.3 + k * radius); (m.material as THREE.MeshBasicMaterial).opacity = 1 - k; });
  }

  /** Runs fn after a delay (impacts that have no projectile). */
  delay(seconds: number, fn: () => void): void {
    let t = 0;
    this.add(dt => { if (dt === Infinity) return false; t += dt; if (t >= seconds) { fn(); return false; } return true; });
  }

  /** Projectiles. `onImpact` fires on arrival. A glowing orb: fire (core/glow/trail colours) or water. */
  orb(from: THREE.Vector3, to: THREE.Vector3, palette: { core: string; glow: string; trail: [string, string]; rise: number }, onImpact: () => void): void {
    const ball = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), new THREE.MeshBasicMaterial({ color: palette.core }));
    ball.add(core, this.glow(palette.glow, 2.4));
    const light = this.flashLight(from, palette.glow, 18, 0.5, 8);
    this.fly(ball, from, to, 0.5, 0.6, p => {
      this.emit({ pos: p, count: 4, color: this.rng() > 0.5 ? palette.trail[0] : palette.trail[1], speed: 0.6, up: palette.rise, life: 0.45, size: 0.3, jitter: 0.15, gravity: palette.rise < 0 ? 4 : 0 });
      light.position.copy(p); // the light rides with the orb
    }, () => {
      this.burst(to, palette.glow, 90, 6);
      this.ring(to, palette.trail[1]);
      onImpact();
    });
  }

  fireball(from: THREE.Vector3, to: THREE.Vector3, onImpact: () => void): void {
    this.orb(from, to, { core: '#ffe0a0', glow: '#ff7a2e', trail: ['#ff7a2e', '#ffcc55'], rise: 1 }, onImpact);
  }

  waterOrb(from: THREE.Vector3, to: THREE.Vector3, onImpact: () => void): void {
    this.orb(from, to, { core: '#e6fbff', glow: '#36b4e8', trail: ['#7fd4ff', '#9fe6ff'], rise: -0.5 }, onImpact);
  }

  crescent(from: THREE.Vector3, to: THREE.Vector3, onImpact: () => void): void {
    const blade = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.07, 6, 28, Math.PI * 1.1), new THREE.MeshBasicMaterial({ color: '#d9fff0', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    const holder = new THREE.Group();
    holder.add(blade, this.glow('#9fe8c4', 1.6));
    this.fly(holder, from, to, 0.38, 0, (p, dt) => {
      blade.rotation.z += dt * 18;
      this.emit({ pos: p, count: 3, color: '#c8ffe6', speed: 0.4, life: 0.3, size: 0.18, jitter: 0.4 });
    }, () => { this.burst(to, '#9fe8c4', 50, 5); onImpact(); });
  }

  boulder(from: THREE.Vector3, to: THREE.Vector3, onImpact: () => void): void {
    const rock = new THREE.Mesh(this.rockGeo, this.rockMat);
    rock.castShadow = true;
    rock.scale.setScalar(1.1);
    this.fly(rock, from, to, 0.7, 2.6, (_p, dt) => { rock.rotation.x += dt * 6; rock.rotation.y += dt * 4; }, () => {
      this.emit({ pos: to, count: 70, color: '#c9a979', speed: 4, up: 0.8, life: 0.9, size: 0.45, gravity: 4, drag: 2 });
      this.ring(to, '#e7c48a', 3.5);
      onImpact();
    });
  }

  bolt(from: THREE.Vector3, to: THREE.Vector3, onImpact: () => void): void {
    const strike = this.lightning(from, to, 0.05, '#fff7c2');
    const boltMat = (strike.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    // flickers for the first third, then holds and fades: long enough to read, short enough to feel like lightning
    this.temp(strike, 0.5, k => { strike.visible = k > 0.33 || Math.floor(k * 18) % 2 === 0; boltMat.opacity = k < 0.5 ? 1 : (1 - k) * 2; });
    this.burst(to, '#ffe45c', 70, 7);
    onImpact();
  }

  /** A thunderclap from the sky onto `at`. */
  skyStrike(at: THREE.Vector3): void {
    const top = at.clone().add(new THREE.Vector3(this.rand(-1.5, 1.5), 14, this.rand(-1, 1)));
    const strike = this.lightning(top, at, 0.08, '#fff7c2');
    const skyMat = (strike.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    this.temp(strike, 0.55, k => { strike.visible = k > 0.35 || Math.floor(k * 20) % 2 === 0; skyMat.opacity = k < 0.5 ? 1 : (1 - k) * 2; });
    this.burst(at, '#ffe45c', 80, 6);
    this.ring(at, '#fff7c2', 4);
  }

  private lightning(from: THREE.Vector3, to: THREE.Vector3, width: number, color: string): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
    const make = (a: THREE.Vector3, b: THREE.Vector3, w: number, segments: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segments; i++) {
        const p = a.clone().lerp(b, i / segments);
        if (i > 0 && i < segments) p.add(new THREE.Vector3(this.rand(), this.rand(), this.rand()).multiplyScalar(a.distanceTo(b) * 0.06));
        pts.push(p);
      }
      // a thin tube through the jagged points: visible from any angle (flat ribbons vanish edge-on)
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
      return { mesh: new THREE.Mesh(new THREE.TubeGeometry(path, segments * 2, w, 5), mat), pts };
    };
    const main = make(from, to, width, 12);
    g.add(main.mesh);
    for (let f = 0; f < 3; f++) { // forks
      const start = main.pts[3 + f * 3];
      g.add(make(start, start.clone().add(new THREE.Vector3(this.rand(), this.rand(-1, 0.3), this.rand()).multiplyScalar(2.2)), width * 0.5, 5).mesh);
    }
    this.flashLight(to.clone().add(new THREE.Vector3(0, 1, 0)), color, 60, 0.3, 18);
    return g;
  }

  private fly(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, seconds: number, arc: number,
    trail: (p: THREE.Vector3, dt: number) => void, arrive: () => void): void {
    obj.position.copy(from);
    this.temp(obj, seconds, (k, dt) => {
      obj.position.lerpVectors(from, to, k);
      obj.position.y += Math.sin(k * Math.PI) * arc;
      trail(obj.position, dt);
    }, arrive);
  }

  // --- defences and lingering effects ---------------------------------------------------------------------------

  /** Water dome or stone wall at a fighter while active() holds (the rules decide: duration or absorbed).
   *  facing: +1 when the fighter faces -z, -1 when facing +z. */
  shield(kind: 'water' | 'stone', at: THREE.Vector3, facing: number, active: () => boolean): void {
    let obj: THREE.Object3D, apply: (vis: number, dt: number) => void;
    if (kind === 'water') {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uFade: { value: 0 } },
        vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform float uTime, uFade; varying vec3 vN; varying vec3 vV; varying vec3 vP;
          void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2); float r = sin(vP.y*9.0 - uTime*4.0)*0.5+0.5;
            gl_FragColor = vec4(vec3(0.35,0.8,1.0) * (0.25 + f*1.4 + r*0.15), (0.12 + f*0.75) * uFade); }`,
      });
      obj = new THREE.Mesh(new THREE.SphereGeometry(1.7, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      obj.position.set(at.x, 0, at.z);
      apply = (vis, dt) => { mat.uniforms.uTime.value += dt; mat.uniforms.uFade.value = vis; };
      this.emit({ pos: new THREE.Vector3(at.x, 0.3, at.z), count: 60, color: '#9fe6ff', speed: 3, up: 2, life: 0.6, size: 0.3, gravity: 6 });
    } else {
      const wall = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const slab = new THREE.Mesh(this.rockGeo, this.rockMat);
        slab.scale.set(1.0 + this.rng() * 0.5, 2.2 + this.rng() * 1.2, 0.8);
        slab.position.set((i - 2) * 0.62, 0, 0);
        slab.rotation.set(this.rand(-0.2, 0.2), this.rand(), this.rand(-0.15, 0.15));
        slab.castShadow = true;
        wall.add(slab);
      }
      wall.position.set(at.x, -1.6, at.z - 1.5 * facing);
      obj = wall;
      apply = vis => { wall.position.y = -1.6 + vis * 1.6; }; // erupts from the ground, sinks when it breaks
      this.emit({ pos: new THREE.Vector3(at.x, 0.2, at.z - 1.5 * facing), count: 70, color: '#c9a979', speed: 3, up: 1.5, life: 0.8, size: 0.4, gravity: 5, jitter: 1.2 });
    }
    this.group.add(obj);
    let t = 0, out = 0;
    this.add(dt => {
      if (dt !== Infinity) {
        t += dt;
        out = active() ? 0 : out + dt / 0.35;
        apply(Math.min(1, t * 6) * (1 - Math.min(1, out)), dt);
        if (out < 1) return true;
      }
      this.discard(obj);
      return false;
    });
  }

  /** Roots binding a fighter's feet for `seconds`. */
  roots(at: THREE.Vector3, seconds: number): void {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: '#5b4126', roughness: 0.9 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, r0 = 0.9;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(a) * r0, 0, Math.sin(a) * r0),
        new THREE.Vector3(Math.cos(a) * 0.55, 0.5, Math.sin(a) * 0.55),
        new THREE.Vector3(Math.cos(a + 0.8) * 0.3, 0.9, Math.sin(a + 0.8) * 0.3),
      ]);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.05, 5), mat));
    }
    g.position.set(at.x, 0, at.z);
    this.temp(g, seconds, k => { g.scale.y = Math.min(1, k * 8) * (k > 0.85 ? (1 - k) / 0.15 : 1); });
  }

  /** Statuses drawn every frame while they last: burning, slowed, stunned. */
  aura(at: THREE.Vector3, burning: boolean, slowed: boolean, stunned: boolean, headY: number, dt: number): void {
    const rate = Math.min(1, dt * 60);
    if (burning && this.rng() < rate) this.emit({ pos: this.v.set(at.x + this.rand(-0.4, 0.4), 0.4 + this.rng() * 1.2, at.z), count: 3, color: this.rng() > 0.4 ? '#ff7a2e' : '#ffd36a', speed: 0.3, up: 3, life: 0.6, size: 0.35, gravity: -2 });
    if (slowed && this.rng() < rate * 0.6) {
      const a = this.rng() * Math.PI * 2;
      this.emit({ pos: this.v.set(at.x + Math.cos(a) * 0.9, 0.2 + this.rng() * 1.6, at.z + Math.sin(a) * 0.9), count: 1, color: '#7fd4ff', speed: 0.6, life: 0.8, size: 0.22, dir: new THREE.Vector3(-Math.sin(a), -0.3, Math.cos(a)).multiplyScalar(1.5) });
    }
    if (stunned && this.rng() < rate) {
      const a = this.clock * 8;
      for (let s = 0; s < 3; s++) this.emit({ pos: this.v.set(at.x + Math.cos(a + s * 2.1) * 0.45, headY, at.z + Math.sin(a + s * 2.1) * 0.45), count: 1, color: '#fff3a0', speed: 0.05, life: 0.35, size: 0.2, jitter: 0.02 });
    }
  }

  heal(at: THREE.Vector3): void {
    this.emit({ pos: new THREE.Vector3(at.x, 0.2, at.z), count: 80, color: '#8ff0c8', speed: 1, up: 4, life: 1.2, size: 0.28, gravity: -1.5, jitter: 0.8 });
    this.ring(at, '#8ff0c8', 2.5);
  }

  gustStreaks(from: THREE.Vector3, toward: THREE.Vector3): void {
    const dir = toward.clone().sub(from).normalize().multiplyScalar(14);
    for (let i = 0; i < 4; i++) this.emit({ pos: from.clone().add(new THREE.Vector3(this.rand(-2, 2), this.rand(0.3, 2.5), 0)), count: 18, color: '#e6fff2', speed: 0.5, life: 0.7, size: 0.16, drag: 0.4, dir, jitter: 0.6 });
  }

  /** The traced sigil lifting out of the pad into the world, then dissolving into the spell. */
  sigil(image: HTMLCanvasElement, at: THREE.Vector3, color: THREE.ColorRepresentation): void {
    const tex = new THREE.CanvasTexture(image);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1), mat);
    plane.position.copy(at);
    plane.rotation.y = Math.PI; // the Babaylan faces -z; show the sigil to the camera behind her
    this.temp(plane, 0.75, k => { plane.position.y = at.y + k * 0.6; plane.scale.setScalar(0.7 + k * 0.7); mat.opacity = k < 0.2 ? k * 5 : 1 - (k - 0.2) / 0.8; }, () => tex.dispose());
  }

  /** Ash for a fizzled cast. */
  fizzle(at: THREE.Vector3): void {
    this.emit({ pos: at, count: 40, color: '#8a8070', speed: 1, up: 0.5, life: 0.9, size: 0.18, gravity: 1.5, jitter: 0.4 });
  }

  /** Shards when a telegraph is interrupted. */
  shatter(at: THREE.Vector3, color: THREE.ColorRepresentation): void {
    this.emit({ pos: at, count: 70, color, speed: 6, life: 0.5, size: 0.22, drag: 2 });
    this.ring(at, color, 2.5);
  }
}

function glowTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
