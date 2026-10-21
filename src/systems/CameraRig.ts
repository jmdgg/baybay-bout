// Camera: over-the-shoulder duel shot, a slow drifting title shot, and short impact shake.
import * as THREE from 'three';

const DUEL_POS = new THREE.Vector3(2.4, 3.5, 12.6);
const DUEL_LOOK = new THREE.Vector3(-0.35, 1.25, -3.6);
// "Duel a friend": side-on, both fighters equally framed (P1 left, P2 right), the palayan behind them
const VERSUS_POS = new THREE.Vector3(12.5, 4.6, 0.75);
const VERSUS_LOOK = new THREE.Vector3(0, 1.35, 0.75);

export class CameraRig {
  private mode: 'title' | 'duel' | 'versus' = 'title';
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly targetPos = new THREE.Vector3();
  private readonly targetLook = new THREE.Vector3();
  private readonly shakeOffset = new THREE.Vector3();
  private shakeAmount = 0;
  private time = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.setMode('title', true);
  }

  setMode(mode: 'title' | 'duel' | 'versus', snap = false): void {
    this.mode = mode;
    this.computeTargets();
    if (snap) { this.pos.copy(this.targetPos); this.look.copy(this.targetLook); this.apply(); }
  }

  shake(amount: number): void { this.shakeAmount = Math.min(0.6, this.shakeAmount + amount); }

  private computeTargets(): void {
    if (this.mode === 'duel') { this.targetPos.copy(DUEL_POS); this.targetLook.copy(DUEL_LOOK); return; }
    if (this.mode === 'versus') { this.targetPos.copy(VERSUS_POS); this.targetLook.copy(VERSUS_LOOK); return; }
    const a = 0.55 + Math.sin(this.time * 0.05) * 0.35; // drift across the field
    this.targetPos.set(Math.sin(a) * 19, 7.5, 4 + Math.cos(a) * 15);
    this.targetLook.set(-3, 1.5, -6);
  }

  update(dt: number): void {
    this.time += dt;
    this.computeTargets();
    const k = 1 - Math.exp(-dt * (this.mode === 'title' ? 1.2 : 2.6));
    this.pos.lerp(this.targetPos, k);
    this.look.lerp(this.targetLook, k);
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.8);
    this.apply();
  }

  private apply(): void {
    const s = this.shakeAmount * this.shakeAmount;
    this.camera.position.copy(this.pos).add(this.shakeOffset.set(Math.sin(this.time * 61) * s, Math.sin(this.time * 47) * s, 0));
    this.camera.lookAt(this.look);
  }
}
