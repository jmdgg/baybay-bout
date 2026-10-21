// The Aswang's telegraph in the world: its glyph (with kudlit) floating above its head, ringed by a countdown.
import * as THREE from 'three';

export class Telegraph {
  readonly group = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private readonly glyph: THREE.Sprite;
  private readonly ringMat: THREE.ShaderMaterial;
  private shown = false;
  private fade = 0;

  constructor() {
    this.canvas.width = this.canvas.height = 256;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.glyph = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, depthTest: false }));
    this.glyph.scale.setScalar(1.5);
    this.glyph.renderOrder = 10;
    this.ringMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false,
      uniforms: { uProgress: { value: 1 }, uColor: { value: new THREE.Color('#ff7a2e') }, uFade: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uProgress, uFade; uniform vec3 uColor; varying vec2 vUv;
        void main(){ vec2 p = vUv - 0.5; float r = length(p); float a = atan(p.x, p.y) / 6.2831853 + 0.5;
          float band = smoothstep(0.5, 0.47, r) * smoothstep(0.40, 0.43, r);
          float on = step(a, uProgress);
          gl_FragColor = vec4(mix(vec3(0.15), uColor, on), band * (0.35 + 0.65 * on) * uFade); }`,
    });
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), this.ringMat);
    ring.renderOrder = 9;
    this.group.add(ring, this.glyph);
    this.group.visible = false;
  }

  show(text: string, color: string): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 256);
    ctx.font = '150px "Noto Sans Tagalog"';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = color; ctx.shadowBlur = 28;
    ctx.fillStyle = '#fff6e8';
    ctx.fillText(text, 128, 140);
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3; ctx.strokeStyle = color;
    ctx.strokeText(text, 128, 140);
    this.texture.needsUpdate = true;
    (this.ringMat.uniforms.uColor.value as THREE.Color).set(color);
    this.shown = true;
    this.group.visible = true;
  }

  hide(): void { this.shown = false; }

  /** progress: 1 at the start of the windup, 0 when the spell lands. */
  update(dt: number, time: number, at: THREE.Vector3, camera: THREE.Camera, progress: number): void {
    this.fade = THREE.MathUtils.clamp(this.fade + (this.shown ? dt * 5 : -dt * 4), 0, 1);
    this.group.visible = this.fade > 0;
    if (!this.group.visible) return;
    this.group.position.set(at.x, at.y + 4.0 + Math.sin(time * 3) * 0.05, at.z);
    this.group.quaternion.copy(camera.quaternion); // billboard
    this.ringMat.uniforms.uProgress.value = progress;
    this.ringMat.uniforms.uFade.value = this.fade;
    (this.glyph.material as THREE.SpriteMaterial).opacity = this.fade;
    const pulse = 1 + (1 - progress) * 0.25 * Math.abs(Math.sin(time * 12));
    this.glyph.scale.setScalar(1.5 * pulse);
  }
}
