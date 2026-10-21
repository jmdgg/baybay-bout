// The Aswang: procedural model with pivot-based animation (hover idle, telegraph windup, release, hit, knockback,
// interrupt recoil, stun, slow, death dissolve, victory cackle).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSeededRandom } from '../utils/random';
import { ENEMY_POS } from '../world/shared';

const rand = createSeededRandom(11);

function softGlow(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d')!, g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

function skinTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#7d8a78';
  ctx.fillRect(0, 0, 128, 256);
  ctx.strokeStyle = 'rgba(40,46,40,0.55)'; // ribs showing through
  ctx.lineWidth = 5;
  for (let y = 70; y < 170; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.quadraticCurveTo(64, y + 14, 128, y); ctx.stroke(); }
  for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(${40 + rand() * 30},${50 + rand() * 30},${40 + rand() * 20},0.25)`; ctx.fillRect(rand() * 128, rand() * 256, 2, 2); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function tatteredShroud(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.24, 0.62, 1.35, 28, 6, true);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const cut = Array.from({ length: 29 }, () => rand() * 0.45);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), a = Math.atan2(pos.getZ(i), pos.getX(i)), idx = Math.round(((a + Math.PI) / (Math.PI * 2)) * 28);
    const t = (0.675 - y) / 1.35; // 0 top, 1 hem
    const ripple = 1 + Math.sin(a * 5 + y * 4) * 0.06 * t;
    pos.setX(i, pos.getX(i) * ripple); pos.setZ(i, pos.getZ(i) * ripple);
    if (t > 0.99) pos.setY(i, y + cut[idx]); // ragged hem
  }
  geo.computeVertexNormals();
  return geo;
}

function hairStrands(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 46; i++) {
    const a = rand() * Math.PI * 1.6 + Math.PI * 0.7, len = 0.5 + rand() * 0.55; // mostly behind and to the sides
    const strand = new THREE.PlaneGeometry(0.035 + rand() * 0.03, len, 1, 4);
    strand.translate(0, -len / 2, 0);
    strand.rotateY(-a);
    strand.rotateX(0.18 + rand() * 0.2);
    strand.translate(Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12);
    parts.push(strand);
  }
  return mergeGeometries(parts);
}

export class Aswang {
  readonly group = new THREE.Group();
  /** Spells leave from between the hands. */
  readonly castPoint = new THREE.Object3D();
  private readonly root = new THREE.Group();
  private readonly spine = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly elbowR = new THREE.Group();
  private readonly elbowL = new THREE.Group();
  private readonly skin: THREE.MeshStandardMaterial;
  private readonly eyeMat = new THREE.MeshStandardMaterial({ color: '#ff3b2f', emissive: '#ff2a1a', emissiveIntensity: 3 });
  private readonly handGlowMat = new THREE.SpriteMaterial({ map: softGlow(), color: '#ff7a2e', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  private readonly handLight = new THREE.PointLight('#ff7a2e', 0, 6, 2);
  private readonly materials: THREE.Material[] = [];
  private windup = 0;          // 0..1 while a telegraphed spell builds
  private windingUp = false;
  private releaseT = -1;
  private recoilT = -1;
  private hitT = -1;
  private knockT = -1;
  private status = { stunned: false, slowed: false };
  private ending: 'dead' | 'won' | null = null;
  private endT = 0;
  private clock = 0;

  constructor() {
    this.skin = new THREE.MeshStandardMaterial({ map: skinTexture(), roughness: 0.75 });
    const cloth = new THREE.MeshStandardMaterial({ color: '#2b2433', roughness: 0.95, side: THREE.DoubleSide });
    const hair = new THREE.MeshStandardMaterial({ color: '#120d0e', roughness: 0.8, side: THREE.DoubleSide });
    const bone = new THREE.MeshStandardMaterial({ color: '#d9cfb0', roughness: 0.5 });
    this.materials.push(this.skin, cloth, hair, bone, this.eyeMat);

    this.spine.position.y = 1.0;
    const shroud = new THREE.Mesh(tatteredShroud(), cloth);
    shroud.position.y = -0.2;
    const torso = new THREE.Mesh(new THREE.LatheGeometry([[0.001, 0], [0.16, 0.02], [0.2, 0.25], [0.24, 0.55], [0.17, 0.72], [0.06, 0.8], [0.001, 0.8]].map(([r, y]) => new THREE.Vector2(r, y)), 20), this.skin);
    torso.scale.z = 0.75;
    this.spine.add(shroud, torso);
    // knobbly spine along the back
    const vertebrae = new THREE.Mesh(mergeGeometries(Array.from({ length: 7 }, (_, i) => new THREE.ConeGeometry(0.03, 0.07, 5).rotateX(-Math.PI / 2).translate(0, 0.15 + i * 0.09, -0.17 + Math.sin(i * 0.5) * 0.02))), bone);
    this.spine.add(vertebrae);

    this.head.position.y = 0.82;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 16), this.skin);
    skull.scale.set(0.85, 1.2, 1);
    skull.position.y = 0.12;
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), this.skin);
    jaw.position.set(0, 0.0, 0.05); jaw.scale.set(0.9, 0.7, 1.1);
    const eyes = new THREE.Mesh(mergeGeometries([-0.055, 0.055].map(x => new THREE.SphereGeometry(0.028, 10, 8).translate(x, 0.15, 0.12))), this.eyeMat);
    const fangs = new THREE.Mesh(mergeGeometries([-0.03, 0.03].map(x => new THREE.ConeGeometry(0.012, 0.06, 5).rotateX(Math.PI).translate(x, -0.02, 0.12))), bone);
    const hairMesh = new THREE.Mesh(hairStrands(), hair);
    hairMesh.position.y = 0.12;
    const eyeLight = new THREE.PointLight('#ff3b2f', 0.6, 2.5, 2);
    eyeLight.position.set(0, 0.15, 0.25);
    this.head.add(skull, jaw, eyes, fangs, hairMesh, eyeLight);
    this.spine.add(this.head);

    // long arms ending in clawed hands
    for (const [arm, elbow, side] of [[this.armR, this.elbowR, 1], [this.armL, this.elbowL, -1]] as const) {
      arm.position.set(0.22 * side, 0.68, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.42, 4, 8), this.skin);
      upper.position.y = -0.25;
      elbow.position.y = -0.5;
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.46, 4, 8), this.skin);
      fore.position.y = -0.26;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), this.skin);
      hand.position.y = -0.53; hand.scale.set(1, 1.3, 0.7);
      const claws = new THREE.Mesh(mergeGeometries([-0.03, -0.01, 0.01, 0.03].map((x, i) => new THREE.ConeGeometry(0.009, 0.13, 4).rotateX(Math.PI + 0.3).translate(x, -0.62 - (i % 2) * 0.02, 0.03))), bone);
      const glow = new THREE.Sprite(this.handGlowMat);
      glow.position.y = -0.56; glow.scale.setScalar(0.5);
      elbow.add(fore, hand, claws, glow);
      arm.add(upper, elbow);
      this.spine.add(arm);
    }
    this.castPoint.position.set(0, 0.55, 0.45);
    this.handLight.position.set(0, 0.55, 0.35);
    this.spine.add(this.castPoint, this.handLight);

    // thin dangling legs under the shroud
    const shins = new THREE.Mesh(mergeGeometries([-0.1, 0.1].map(x => new THREE.CapsuleGeometry(0.03, 0.5, 4, 6).translate(x, 0.25, 0))), this.skin);
    this.root.add(shins, this.spine);
    this.root.traverse(o => { o.castShadow = true; });
    this.group.add(this.root);
    this.group.position.copy(ENEMY_POS);
    this.group.scale.setScalar(1.12);
  }

  reset(): void {
    this.windup = 0; this.windingUp = false;
    this.releaseT = this.recoilT = this.hitT = this.knockT = -1;
    this.ending = null;
    this.status = { stunned: false, slowed: false };
    for (const m of this.materials) { m.transparent = false; m.opacity = 1; }
    this.group.visible = true;
  }

  /** The telegraph starts: rear up and gather the element in the hands. */
  beginWindup(color: THREE.ColorRepresentation): void {
    this.windingUp = true;
    this.handGlowMat.color.set(color);
    this.handLight.color.set(color);
  }
  release(): void { this.windingUp = false; this.releaseT = 0; }
  interrupted(): void { this.windingUp = false; this.recoilT = 0; }
  hit(): void { this.hitT = 0; }
  knockback(): void { this.knockT = 0; this.hitT = 0; }
  setStatus(stunned: boolean, slowed: boolean): void { this.status = { stunned, slowed }; }
  /** win: the Aswang won (cackles); lose: it is banished (dissolves). */
  end(result: 'win' | 'lose'): void { this.ending = result === 'win' ? 'won' : 'dead'; this.endT = 0; this.windingUp = false; }
  /** Same interface as the Babaylan: the Aswang's spell leaves its hands at once. */
  castFrom(_color: THREE.ColorRepresentation, onRelease: () => void): void { this.release(); onRelease(); }
  castOrigin(): THREE.Vector3 { return this.worldCastPoint; }
  get worldCastPoint(): THREE.Vector3 { return this.castPoint.getWorldPosition(new THREE.Vector3()); }

  update(dt: number): void {
    const speed = this.status.slowed ? 0.5 : 1;
    this.clock += dt * speed;
    const t = this.clock;
    this.windup = THREE.MathUtils.clamp(this.windup + (this.windingUp ? dt * 1.6 : -dt * 3), 0, 1);
    const w = this.windup;

    let hover = 0.32 + Math.sin(t * 1.8) * 0.07, hunch = 0.5 - 0.6 * w, headX = 0.25 - 0.35 * w + Math.sin(t * 0.8) * 0.06;
    let headZ = Math.sin(t * 0.55) * 0.15, armX = -0.25 + Math.sin(t * 1.3) * 0.08, armSpread = 0.35, elbow = -0.35;
    armX = THREE.MathUtils.lerp(armX, -2.3, w); armSpread = THREE.MathUtils.lerp(armSpread, 0.9, w); elbow = THREE.MathUtils.lerp(elbow, -0.6, w);
    let back = 0;

    if (this.releaseT >= 0) {
      this.releaseT += dt;
      const k = Math.sin(Math.min(1, this.releaseT / 0.35) * Math.PI);
      armX = THREE.MathUtils.lerp(armX, -1.45, k); armSpread = THREE.MathUtils.lerp(armSpread, 0.12, k); hunch += 0.25 * k;
      if (this.releaseT > 0.35) this.releaseT = -1;
    }
    if (this.recoilT >= 0) {
      this.recoilT += dt;
      const k = Math.max(0, 1 - this.recoilT / 0.6);
      hunch -= 0.4 * k; headX -= 0.5 * k; armSpread += 0.6 * k;
      if (this.recoilT > 0.6) this.recoilT = -1;
    }
    if (this.hitT >= 0) {
      this.hitT += dt;
      const k = Math.max(0, 1 - this.hitT / 0.4);
      hunch -= 0.35 * k; headX -= 0.3 * k;
      this.skin.emissive.setRGB(0.6 * k, 0.15 * k, 0.05 * k);
      if (this.hitT > 0.4) this.hitT = -1;
    } else {
      this.skin.emissive.set(this.status.slowed ? '#0d2f55' : '#000000');
    }
    if (this.knockT >= 0) {
      this.knockT += dt;
      const k = this.knockT;
      back = k < 0.18 ? (k / 0.18) * 1.6 : 1.6 * Math.max(0, 1 - (k - 0.18) / 0.9);
      if (k > 1.1) this.knockT = -1;
    }
    if (this.status.stunned) { headZ += Math.sin(t * 6) * 0.35; headX += 0.25; hover -= 0.1; armX = -0.1; }
    if (this.ending === 'dead') {
      this.endT = Math.min(1, this.endT + dt * 0.6);
      const e = this.endT;
      hover = THREE.MathUtils.lerp(hover, -0.2, e); hunch = 0.9 * e; headX = 0.6 * e;
      for (const m of this.materials) { m.transparent = true; m.opacity = 1 - e; }
      if (e >= 1) this.group.visible = false;
    } else if (this.ending === 'won') {
      this.endT += dt;
      headX = -0.6 + Math.sin(this.endT * 14) * 0.08; // head thrown back, cackling
      armX = -1.0; armSpread = 0.9; hunch = 0.0;
    }

    this.root.position.set(0, hover, -back);
    this.spine.rotation.x = hunch;
    this.head.rotation.set(headX, 0, headZ);
    this.armR.rotation.set(armX, 0, -armSpread);
    this.armL.rotation.set(armX, 0, armSpread);
    this.elbowR.rotation.x = elbow;
    this.elbowL.rotation.x = elbow;
    this.handGlowMat.opacity = w * 0.9;
    this.handLight.intensity = w * 3;
    this.eyeMat.emissiveIntensity = 2.2 + w * 3 + Math.sin(t * 4) * 0.4;
  }

  stabilize(): void { this.clock = 0; this.update(0); }
}
