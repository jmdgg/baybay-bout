// The player's Babaylan: procedural model with pivot-based animation (idle, cast, hit, stun, slow, win, lose).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLAYER_POS } from '../world/shared';

const SKIN = '#9c6a45';

/** Inabel-style woven stripes for the tapis (skirt). */
/** Colour roles: cloth base, trim (metal and stripes), accent (shawl, putong, sash). */
export interface Palette { base: string; trim: string; accent: string }
export const PALETTES: Record<'p1' | 'p2', Palette> = {
  p1: { base: '#7d1e24', trim: '#d9a441', accent: '#a3242b' }, // red and gold
  p2: { base: '#262a6b', trim: '#c9ced8', accent: '#3d44a8' }, // indigo and silver
};

function wovenTexture(p: Palette): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, 256, 256);
  const band = (y: number, h: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(0, y, 256, h); };
  band(18, 10, p.trim); band(30, 4, '#1e1414'); band(60, 22, '#efe2c4'); band(150, 6, p.trim); band(200, 18, '#1e1414'); band(224, 8, p.trim);
  ctx.fillStyle = p.base;
  for (let x = 0; x < 256; x += 16) { // diamond (binakol-like) motif across the light band
    ctx.beginPath(); ctx.moveTo(x + 8, 62); ctx.lineTo(x + 16, 71); ctx.lineTo(x + 8, 80); ctx.lineTo(x, 71); ctx.fill();
  }
  ctx.fillStyle = p.trim;
  for (let x = 0; x < 256; x += 8) ctx.fillRect(x, 203, 4, 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  return tex;
}

function lathe(points: [number, number][], segments = 24): THREE.LatheGeometry {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

function limb(length: number, radius: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), mat);
  m.position.y = -length / 2; // hangs from its pivot
  m.castShadow = true;
  return m;
}

export class Babaylan {
  readonly group = new THREE.Group();
  /** Where spells leave the staff (world position read by the VFX). */
  readonly staffTip = new THREE.Object3D();
  private readonly body = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly elbowR = new THREE.Group();
  private readonly elbowL = new THREE.Group();
  private readonly skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.65 });
  private readonly gemMat = new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ffb347', emissiveIntensity: 1.2, roughness: 0.2 });
  private readonly gemLight = new THREE.PointLight('#ffb347', 0.6, 4, 2);
  private castT = -1;
  private castColor = new THREE.Color('#ffb347');
  private onRelease: (() => void) | null = null;
  private hitT = -1;
  private status = { stunned: false, slowed: false };
  private ending: 'win' | 'lose' | null = null;
  private endT = 0;
  private clock = 0;

  constructor({ position = PLAYER_POS, facing = -1, palette = PALETTES.p1 }: { position?: THREE.Vector3; facing?: 1 | -1; palette?: Palette } = {}) {
    const cloth = new THREE.MeshStandardMaterial({ map: wovenTexture(palette), roughness: 0.85 });
    const baro = new THREE.MeshStandardMaterial({ color: '#e9dcc0', roughness: 0.8 });
    const red = new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.7 });
    const gold = new THREE.MeshStandardMaterial({ color: palette.trim, roughness: 0.35, metalness: 0.6 });
    const hair = new THREE.MeshStandardMaterial({ color: '#1b1412', roughness: 0.6 });
    const wood = new THREE.MeshStandardMaterial({ color: '#5a3a22', roughness: 0.7 });

    // skirt (tapis) and blouse (baro)
    const skirt = new THREE.Mesh(lathe([[0.001, 1.02], [0.17, 1.02], [0.22, 0.8], [0.33, 0.35], [0.45, 0.04], [0.001, 0.04]], 28), cloth);
    const feet = new THREE.Mesh(mergeGeometries([-0.09, 0.09].map(x => new THREE.BoxGeometry(0.08, 0.06, 0.2).translate(x, 0.03, 0.06))), this.skin);
    this.body.add(skirt, feet);
    this.torso.position.y = 1.0;
    const blouse = new THREE.Mesh(lathe([[0.001, 0], [0.16, 0], [0.2, 0.26], [0.19, 0.4], [0.12, 0.49], [0.05, 0.54], [0.001, 0.54]]), baro);
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 24), red);
    sash.rotation.x = Math.PI / 2; sash.position.y = 0.04;
    // a woven shawl (alampay) draped over the shoulders, and a sash tail hanging at the hip
    const shawl = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.25, 0.17, 24, 1, true), new THREE.MeshStandardMaterial({ map: cloth.map, roughness: 0.85, side: THREE.DoubleSide }));
    shawl.position.y = 0.44;
    const sashTail = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.5), new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.7, side: THREE.DoubleSide }));
    sashTail.position.set(0.15, -0.22, 0.12);
    sashTail.rotation.set(0.12, 0.4, 0.08);
    const beads = new THREE.Mesh(mergeGeometries(Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return new THREE.SphereGeometry(0.022, 6, 4).translate(Math.cos(a) * 0.13, 0.47 - Math.abs(Math.sin(a)) * 0.0, Math.sin(a) * 0.13 + 0.02);
    })), gold);
    this.torso.add(blouse, sash, shawl, sashTail, beads);

    // head: neck, face, hair bun, putong (headwrap) with a trailing cloth
    this.head.position.y = 0.56;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 10), this.skin);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), this.skin);
    face.scale.set(0.95, 1.12, 1); face.position.y = 0.15;
    const eyes = new THREE.Mesh(mergeGeometries([-0.04, 0.04].map(x => new THREE.SphereGeometry(0.014, 6, 4).translate(x, 0.17, 0.1))), hair);
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.124, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
    hairCap.position.set(0, 0.16, -0.012); hairCap.rotation.x = -0.25;
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), hair);
    bun.position.set(0, 0.2, -0.13);
    const putong = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.032, 8, 24), red);
    putong.rotation.x = Math.PI / 2 - 0.25; putong.position.y = 0.22;
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.009, 6, 24), gold);
    trim.rotation.x = Math.PI / 2 - 0.25; trim.position.y = 0.2;
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.38), red);
    tail.material.side = THREE.DoubleSide;
    tail.position.set(0.05, 0.05, -0.15); tail.rotation.set(0.3, 0, 0.15);
    this.head.add(neck, face, eyes, hairCap, bun, putong, trim, tail);
    this.torso.add(this.head);

    // arms: shoulder pivot → upper arm → elbow pivot → forearm + hand + bracelet
    for (const [arm, elbow, side] of [[this.armR, this.elbowR, 1], [this.armL, this.elbowL, -1]] as const) {
      arm.position.set(0.22 * side, 0.46, 0);
      arm.add(limb(0.24, 0.045, baro));
      elbow.position.y = -0.3;
      elbow.add(limb(0.22, 0.038, this.skin));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), this.skin);
      hand.position.y = -0.3;
      const bracelet = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 16), gold);
      bracelet.rotation.x = Math.PI / 2; bracelet.position.y = -0.23;
      elbow.add(hand, bracelet);
      arm.add(elbow);
      this.torso.add(arm);
    }

    // staff with an anting-anting gem, held in the right hand
    const staff = new THREE.Group();
    staff.position.set(0, -0.3, 0.02);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 1.75, 8), wood);
    pole.position.y = 0.25;
    const fork = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.016, 6, 16, Math.PI), wood);
    fork.position.y = 1.12;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), this.gemMat);
    gem.position.y = 1.15;
    const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.2, 6), red);
    tassel.position.set(0.05, 0.98, 0); tassel.rotation.z = Math.PI;
    this.gemLight.position.y = 1.15;
    this.staffTip.position.y = 1.15;
    staff.add(pole, fork, gem, tassel, this.gemLight, this.staffTip);
    staff.traverse(o => { o.castShadow = true; });
    this.elbowR.add(staff);

    this.body.add(this.torso);
    this.body.traverse(o => { o.castShadow = true; });
    this.group.add(this.body);
    this.group.position.copy(position);
    this.group.rotation.y = facing < 0 ? Math.PI : 0; // -1 faces -z (toward the Aswang), +1 faces +z
    this.group.scale.setScalar(1.05);
  }

  reset(): void {
    this.castT = this.hitT = -1;
    this.ending = null;
    this.status = { stunned: false, slowed: false };
    this.onRelease = null;
  }

  /** Starts the cast animation; onRelease fires when the staff thrusts (spawn the spell then). */
  cast(color: THREE.ColorRepresentation, onRelease: () => void): void {
    this.castT = 0;
    this.castColor.set(color);
    this.onRelease = onRelease;
  }

  hit(): void { this.hitT = 0; }
  knockback(): void { this.hitT = 0; }
  /** Same interface as the Aswang: animate the cast, run onRelease when the spell leaves the staff. */
  castFrom(color: THREE.ColorRepresentation, onRelease: () => void): void { this.cast(color, onRelease); }
  castOrigin(): THREE.Vector3 { return this.staffTip.getWorldPosition(new THREE.Vector3()); }
  setStatus(stunned: boolean, slowed: boolean): void { this.status = { stunned, slowed }; }
  end(result: 'win' | 'lose'): void { this.ending = result; this.endT = 0; }

  update(dt: number): void {
    const speed = this.status.slowed ? 0.55 : 1;
    this.clock += dt * speed;
    const t = this.clock;
    // idle
    let shoulderR = -0.35, shoulderL = 0.15, elbowR = -0.5, elbowL = -0.2, lean = 0.04 * Math.sin(t * 1.3), bodyY = 0;
    let sway = Math.sin(t * 0.9) * 0.02, headTilt = Math.sin(t * 0.7) * 0.05;
    this.torso.scale.y = 1 + Math.sin(t * 2.2) * 0.012;
    let glow = 0.25 + Math.sin(t * 3) * 0.08;
    this.gemMat.emissive.set('#ffb347');

    if (this.castT >= 0) {
      this.castT += dt * speed;
      const c = this.castT;
      const raise = Math.min(1, c / 0.28), thrust = c < 0.32 ? 0 : Math.min(1, (c - 0.32) / 0.12), settle = c < 0.6 ? 0 : Math.min(1, (c - 0.6) / 0.4);
      shoulderR = THREE.MathUtils.lerp(-0.35, -2.6, raise) + thrust * 1.15;
      elbowR = THREE.MathUtils.lerp(-0.5, -0.15, raise);
      shoulderL = THREE.MathUtils.lerp(0.15, -1.25, raise);
      elbowL = -0.1;
      lean = -0.1 * raise + 0.14 * thrust;
      shoulderR = THREE.MathUtils.lerp(shoulderR, -0.35, settle);
      shoulderL = THREE.MathUtils.lerp(shoulderL, 0.15, settle);
      lean = THREE.MathUtils.lerp(lean, 0, settle);
      glow = 0.25 + 2.5 * raise * (1 - settle);
      this.gemMat.emissive.copy(this.castColor);
      if (thrust > 0 && this.onRelease) { const f = this.onRelease; this.onRelease = null; f(); }
      if (c > 1) this.castT = -1;
    }
    if (this.hitT >= 0) {
      this.hitT += dt;
      const k = Math.max(0, 1 - this.hitT / 0.45);
      lean -= 0.3 * k * Math.sin(Math.min(1, this.hitT / 0.08) * Math.PI / 2);
      this.skin.emissive.setRGB(0.5 * k, 0.05 * k, 0.03 * k);
      if (this.hitT > 0.45) this.hitT = -1;
    } else {
      this.skin.emissive.set(this.status.slowed ? '#0d2a44' : '#000000');
    }
    if (this.status.stunned) { sway += Math.sin(t * 9) * 0.06; headTilt += Math.sin(t * 7) * 0.25; }
    if (this.ending) {
      this.endT = Math.min(1, this.endT + dt * 1.5);
      const e = this.endT;
      if (this.ending === 'win') { shoulderR = THREE.MathUtils.lerp(shoulderR, -2.9, e); elbowR = -0.05; shoulderL = THREE.MathUtils.lerp(shoulderL, -0.6, e); }
      else { bodyY = -0.42 * e; lean = 0.5 * e; headTilt = 0.4 * e; shoulderR = 0.1; shoulderL = 0.2; }
    }

    this.armR.rotation.x = shoulderR;
    this.armL.rotation.x = shoulderL;
    this.armR.rotation.z = -0.12;
    this.armL.rotation.z = 0.12;
    this.elbowR.rotation.x = elbowR;
    this.elbowL.rotation.x = elbowL;
    this.torso.rotation.x = lean;
    this.body.rotation.z = sway;
    this.body.position.y = bodyY;
    this.head.rotation.z = headTilt;
    this.gemMat.emissiveIntensity = 0.8 + glow;
    this.gemLight.color.copy(this.gemMat.emissive);
    this.gemLight.intensity = glow * 1.2;
  }

  /** Stops ambient motion for deterministic screenshots. */
  stabilize(): void { this.clock = 0; this.update(0); }
}
