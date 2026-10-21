// The duel field: sky, lighting, terrain, rivers, palayan water and dikes, flora and props.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildFlora } from './flora';
import { buildProps } from './props';
import { heightAt, paddyCell, PADDY, riverA, riverB, riverDistance, fbm, wind } from './shared';

const SUN_DIR = new THREE.Vector3(-0.62, 0.42, 0.42).normalize();

export class World {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private readonly waterNormals: THREE.Texture;
  private readonly props: ReturnType<typeof buildProps>;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    const sky = buildSky();
    scene.background = new THREE.Color('#e8c79c');
    scene.fog = new THREE.Fog('#e3c49d', 45, 175);
    // image-based fill light from the same sky, so PBR materials and water pick up its colours
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    skyScene.add(buildSky());
    scene.environment = pmrem.fromScene(skyScene, 0.02).texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();
    this.group.add(sky);

    const hemi = new THREE.HemisphereLight('#bcd9f2', '#5c6b2e', 0.9);
    this.group.add(hemi);
    this.sun = new THREE.DirectionalLight('#ffd49a', 3.1);
    this.sun.position.copy(SUN_DIR).multiplyScalar(40);
    this.sun.target.position.set(0, 0, -2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera;
    sc.left = -18; sc.right = 18; sc.top = 18; sc.bottom = -18; sc.near = 5; sc.far = 90;
    this.group.add(this.sun, this.sun.target);
    const rim = new THREE.DirectionalLight('#9fc4ff', 0.9); // cool back light separates the fighters from the field
    rim.position.set(12, 9, -24);
    this.group.add(rim);

    this.waterNormals = buildWaterNormals();
    this.group.add(buildTerrain());
    this.group.add(buildRivers(this.waterNormals));
    this.group.add(buildPaddies(this.waterNormals));
    this.group.add(buildBackdrop());
    this.group.add(buildFlora());
    this.props = buildProps();
    this.group.add(this.props.group);
  }

  /** gust: 0..1 strength of a wind spell, decays here. */
  update(dt: number, time: number): void {
    wind.uTime.value = time;
    wind.uGust.value = Math.max(0, wind.uGust.value - dt * 0.9);
    this.waterNormals.offset.set(time * 0.012, time * 0.02);
  }

  gust(strength: number): void {
    wind.uGust.value = Math.min(1.2, wind.uGust.value + strength);
  }

  /** Lights the player's ritual circle in the element colour while casting. */
  setCircleGlow(color: THREE.ColorRepresentation, intensity: number): void {
    this.props.setCircleGlow(color, intensity);
  }
}

function buildSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uSun; varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 horizon = vec3(1.0, 0.80, 0.58), mid = vec3(0.62, 0.76, 0.90), zenith = vec3(0.30, 0.50, 0.78);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));
        col = mix(col, zenith, smoothstep(0.25, 0.9, h));
        col = mix(col, vec3(0.86, 0.74, 0.56), smoothstep(0.0, -0.2, h));
        float s = max(dot(vDir, uSun), 0.0);
        col += vec3(1.0, 0.72, 0.42) * (pow(s, 6.0) * 0.35 + pow(s, 120.0) * 1.2);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), material);
}

function buildTerrain(): THREE.Mesh {
  const size = 150, seg = 170;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), grass = new THREE.Color('#6d9440'), dry = new THREE.Color('#a8a453'),
    dirt = new THREE.Color('#9c7650'), mud = new THREE.Color('#6d5536'), bank = new THREE.Color('#8f7f55');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    const n = fbm(x * 0.12, z * 0.12);
    c.copy(grass).lerp(dry, Math.min(1, Math.max(0, (n - 0.35) * 1.6)));
    c.offsetHSL(0, 0, (fbm(x * 0.6, z * 0.6) - 0.5) * 0.08);
    // worn duel path between the fighters
    const lane = Math.max(0, 1 - Math.hypot(x / 2.4, Math.max(0, Math.abs(z + 1) - 7.5) / 2.4));
    c.lerp(dirt, Math.min(1, lane * 1.3) * (0.55 + n * 0.5));
    const d = riverDistance(x, z);
    if (d < 4.2) c.lerp(bank, Math.min(1, (4.2 - d) / 1.6));
    if (paddyCell(x, z)) c.copy(mud);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

function buildWaterNormals(): THREE.Texture {
  const size = 256, cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const h = (x: number, y: number) => Math.sin(x * 0.09) * 0.6 + Math.sin((x + y) * 0.051) * 0.8 + Math.sin(y * 0.13 - x * 0.03) * 0.5
    + fbm(x * 0.05, y * 0.05) * 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1), i = (y * size + x) * 4;
    img.data[i] = 128 + dx * 60; img.data[i + 1] = 128 + dy * 60; img.data[i + 2] = 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}

const waterMaterial = (normals: THREE.Texture, color: string) => new THREE.MeshStandardMaterial({
  color, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.86,
  normalMap: normals, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.4,
});

function ribbon(path: (t: number) => [number, number], halfWidth: number, steps: number, y: number): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, [x, z] = path(t), [x2, z2] = path(Math.min(1, t + 1 / steps));
    let nx = -(z2 - z), nz = x2 - x;
    const len = Math.hypot(nx, nz) || 1;
    nx /= len; nz /= len;
    positions.push(x + nx * halfWidth, y, z + nz * halfWidth, x - nx * halfWidth, y, z - nz * halfWidth);
    uvs.push(0, t * steps * 0.15, 1, t * steps * 0.15);
    if (i < steps) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

function buildRivers(normals: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const mat = waterMaterial(normals, '#3f7f86');
  const a = new THREE.Mesh(ribbon(t => { const x = -75 + t * 150; return [x, riverA(x)]; }, 2.5, 120, -0.62), mat);
  const b = new THREE.Mesh(ribbon(t => { const z = 60 - t * 120; return [riverB(z), z]; }, 2.3, 100, -0.62), mat);
  a.receiveShadow = b.receiveShadow = true;
  g.add(a, b);
  g.name = 'rivers';
  return g;
}

function buildPaddies(normals: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const water = waterMaterial(normals, '#7c9a74');
  water.opacity = 0.78;
  const dikeGeos: THREE.BufferGeometry[] = [];
  const rowDepth = (PADDY.z1 - PADDY.z0) / PADDY.rows;
  const cols = 3, colWidth = (PADDY.x1 - PADDY.x0) / cols;
  for (let row = 0; row < PADDY.rows; row++) {
    const zFront = PADDY.z1 - row * rowDepth, zBack = zFront - rowDepth, level = 0.15 + row * 0.55;
    for (let col = 0; col < cols; col++) {
      const x0 = PADDY.x0 + col * colWidth, cx = x0 + colWidth / 2, cz = (zFront + zBack) / 2;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(colWidth - 0.6, rowDepth - 0.6), water);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(cx, level + 0.07, cz);
      plane.receiveShadow = true;
      g.add(plane);
      // pilapil: low mud dikes around each paddy
      for (const [w, d, x, z] of [[colWidth, 0.5, cx, zFront], [colWidth, 0.5, cx, zBack], [0.5, rowDepth, x0, cz], [0.5, rowDepth, x0 + colWidth, cz]]) {
        const dike = new THREE.BoxGeometry(w, 0.32, d, Math.max(1, Math.round(w)), 1, Math.max(1, Math.round(d)));
        dike.translate(x, level + 0.1, z);
        dikeGeos.push(dike);
      }
    }
  }
  const dikes = new THREE.Mesh(mergeGeometries(dikeGeos), new THREE.MeshStandardMaterial({ color: '#7a6040', roughness: 1 }));
  dikes.castShadow = dikes.receiveShadow = true;
  g.add(dikes);
  g.name = 'palayan';
  return g;
}

function buildBackdrop(): THREE.Group {
  const g = new THREE.Group();
  // a distant volcano with Mayon's concave profile, gullied slopes and a faint plume, plus a ring of hills
  const H = 52, BASE = 60, ringSeg = 96, rows = 28;
  const positions: number[] = [], colors: number[] = [], index: number[] = [];
  const haze = new THREE.Color('#aab8c4');
  const c = new THREE.Color(), low = new THREE.Color('#58804a'), mid = new THREE.Color('#7f8a5c'), rock = new THREE.Color('#8a8072'), crest = new THREE.Color('#6d655e');
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;                                  // 0 at the foot, 1 at the crater rim
    const radius = BASE * Math.pow(1 - t, 2.1) + 3.2;      // concave slopes: wide skirt, steep summit
    for (let k = 0; k <= ringSeg; k++) {
      const a = (k / ringSeg) * Math.PI * 2;
      const gully = 1 + (Math.sin(a * 17 + fbm(k * 0.3, row * 0.2) * 4) * 0.035 + (fbm(a * 3, t * 6) - 0.5) * 0.08) * (0.3 + t);
      positions.push(Math.cos(a) * radius * gully, t * H - (t > 0.97 ? 1.2 : 0), Math.sin(a) * radius * gully);
      c.copy(low).lerp(mid, Math.min(1, t * 2.2)).lerp(rock, Math.max(0, (t - 0.45) * 2)).lerp(crest, Math.max(0, (t - 0.85) * 5));
      c.offsetHSL(0, 0, (gully - 1) * 1.6);
      c.lerp(haze, 0.38); // aerial perspective by hand: the volcano stays out of the fog so its shape still reads
      colors.push(c.r, c.g, c.b);
      if (row < rows && k < ringSeg) {
        const i = row * (ringSeg + 1) + k, j = i + ringSeg + 1;
        index.push(i, j, i + 1, i + 1, j, j + 1);
      }
    }
  }
  const cone = new THREE.BufferGeometry();
  cone.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  cone.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  cone.setIndex(index);
  cone.computeVertexNormals();
  const volcano = new THREE.Mesh(cone, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, fog: false }));
  volcano.position.set(-42, -2, -165);
  g.add(volcano);
  const plume = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTexture(), color: '#d8d0c4', transparent: true, opacity: 0.55, depthWrite: false }));
  plume.position.set(-38, H + 6, -165);
  plume.scale.set(26, 9, 1);
  g.add(plume);
  const hillMat = new THREE.MeshStandardMaterial({ color: '#5d7f4a', roughness: 1 });
  const hill = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const [x, z, sx, sy] of [[40, -120, 38, 11], [85, -95, 30, 14], [-95, -100, 34, 10], [10, -135, 45, 8], [-70, -60, 22, 7], [70, -55, 20, 6]]) {
    const m = new THREE.Mesh(hill, hillMat);
    m.position.set(x, -1, z);
    m.scale.set(sx, sy, sx * 0.7);
    g.add(m);
  }
  // soft clouds
  const cloudTex = cloudTexture();
  for (let i = 0; i < 7; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    const a = -1.3 + i * 0.42;
    sprite.position.set(Math.sin(a) * 230, 55 + (i % 3) * 14, -Math.cos(a) * 230);
    sprite.scale.set(70 + (i % 2) * 30, 22 + (i % 3) * 6, 1);
    g.add(sprite);
  }
  g.name = 'backdrop';
  return g;
}

function cloudTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 96;
  const ctx = cv.getContext('2d')!;
  for (let i = 0; i < 14; i++) {
    const x = 40 + i * 13 + Math.sin(i * 2.3) * 10, y = 56 - Math.abs(Math.sin(i * 0.9)) * 22, r = 18 + Math.abs(Math.sin(i * 1.7)) * 16;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,248,236,0.9)');
    grad.addColorStop(1, 'rgba(255,236,214,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
