// Instanced tropical flora: coconut palms, banana plants, bushes, grass, palay (rice) and river rocks.
import * as THREE from 'three';
import { createSeededRandom } from '../utils/random';
import { addSway, fbm, heightAt, paddyCell, PADDY, riverDistance } from './shared';

const rng = createSeededRandom(7);
const r = (a: number, b: number) => a + rng() * (b - a);

/** Keep the duel lane, the camera's foreground and the space right around the fighters clear. */
function clearOfDuel(x: number, z: number, margin = 0): boolean {
  if (Math.abs(x) < 5 + margin && z > -12 - margin && z < 15 + margin) return false; // lane + camera
  return true;
}

function scatter(count: number, accept: (x: number, z: number) => boolean, range = 62): [number, number][] {
  const out: [number, number][] = [];
  for (let tries = 0; out.length < count && tries < count * 40; tries++) {
    const x = r(-range, range), z = r(-range, range * 0.45);
    if (accept(x, z)) out.push([x, z]);
  }
  return out;
}

const tmp = new THREE.Object3D();
function place(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, s: number, ry: number, rx = 0, rz = 0) {
  tmp.position.set(x, y, z);
  tmp.rotation.set(rx, ry, rz);
  tmp.scale.setScalar(s);
  tmp.updateMatrix();
  mesh.setMatrixAt(i, tmp.matrix);
}

function leafletTexture(kind: 'palm' | 'banana'): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 256;
  const ctx = cv.getContext('2d')!;
  if (kind === 'palm') {
    ctx.strokeStyle = '#7f9a3c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(32, 0); ctx.lineTo(32, 256); ctx.stroke();
    for (let y = 6; y < 250; y += 7) {
      const len = 30 * Math.sin(Math.PI * Math.min(1, y / 240)) + 4;
      ctx.strokeStyle = y % 14 ? '#5f8a2c' : '#6f9a34'; ctx.lineWidth = 4;
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(32, y); ctx.lineTo(32 + side * len, y + 14); ctx.stroke(); }
    }
  } else {
    const grad = ctx.createLinearGradient(0, 0, 64, 0);
    grad.addColorStop(0, '#4f8a2e'); grad.addColorStop(0.5, '#78ad3e'); grad.addColorStop(1, '#4f8a2e');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.ellipse(32, 128, 30, 126, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c8d98a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(32, 4); ctx.lineTo(32, 252); ctx.stroke();
    ctx.globalCompositeOperation = 'destination-out'; // wind tears along the leaf
    for (let i = 0; i < 9; i++) { const y = 30 + i * 24; ctx.fillRect(i % 2 ? 34 : 0, y, 30, 1.5); }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A leaf strip arching down from its base (palm frond or banana leaf). */
function leafGeometry(length: number, width: number, droop: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, length, 1, 12);
  geo.translate(0, length / 2, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / length; // 0 at the stem, 1 at the tip
    // rises out of the crown, then arches over and droops at the tip
    pos.setXYZ(i, pos.getX(i), Math.sin(t * Math.PI * 0.62) * length * 0.45 - droop * t * t, t * length * 0.85);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A tuft of thin blades (grass or rice) with darker roots and lighter (or golden) tips. */
function tuftGeometry(blades: number, height: number, width: number, root: string, tip: string): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [];
  const cr = new THREE.Color(root), ct = new THREE.Color(tip);
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + r(-0.3, 0.3), lean = r(0.1, 0.35), h = height * r(0.7, 1.1);
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz * width, pz = dx * width;
    const tipX = dx * lean * h, tipZ = dz * lean * h;
    positions.push(-px, 0, -pz, px, 0, pz, tipX, h, tipZ);
    colors.push(cr.r, cr.g, cr.b, cr.r, cr.g, cr.b, ct.r, ct.g, ct.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function palmTrunkGeometry(): THREE.BufferGeometry {
  const height = 7, geo = new THREE.CylinderGeometry(0.17, 0.27, height, 9, 18);
  geo.translate(0, height / 2, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3), a = new THREE.Color('#8a7356'), b = new THREE.Color('#5e4c38');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), t = y / height;
    pos.setX(i, pos.getX(i) + Math.pow(t, 1.8) * 1.6); // the classic coconut lean
    const ring = Math.abs(Math.sin(y * 7.5));
    const c = a.clone().lerp(b, ring * 0.7);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function bushGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 0.78 + fbm(x * 2.3 + 5, z * 2.3 + y * 1.7) * 0.5;
    pos.setXYZ(i, x * k, Math.max(-0.2, y * k * 0.78), z * k);
    c.set('#3f6a2a').lerp(new THREE.Color('#7aa548'), Math.min(1, Math.max(0, (y + 0.3) * 0.75)));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.translate(0, 0.55, 0);
  return geo;
}

function rockGeometry(): THREE.BufferGeometry {
  const geo = new THREE.DodecahedronGeometry(1, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const k = 0.75 + fbm(pos.getX(i) * 1.7 + 9, pos.getZ(i) * 1.7 + pos.getY(i)) * 0.5;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.6, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildFlora(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'flora';
  const open = (x: number, z: number) => clearOfDuel(x, z) && !paddyCell(x, z) && riverDistance(x, z) > 3.8;

  // --- coconut palms: along the rivers, around the palayan, and a grove at the back ---------------------------
  const palmSpots = [
    ...scatter(16, (x, z) => clearOfDuel(x, z, 3) && !paddyCell(x, z) && riverDistance(x, z) > 2.8 && riverDistance(x, z) < 7),
    ...scatter(12, (x, z) => open(x, z) && z < -24),
    ...scatter(6, (x, z) => open(x, z) && x < -8 && x > -36 && z > 4 && z < 14),
    [-7.5, -15], [7.5, -14], [-11, 9], [12.5, 3],
  ] as [number, number][];
  const trunk = new THREE.InstancedMesh(palmTrunkGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), palmSpots.length);
  const frondsPer = 9;
  const frondMat = addSway(new THREE.MeshStandardMaterial({ map: leafletTexture('palm'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }), 0.006);
  const fronds = new THREE.InstancedMesh(leafGeometry(4.2, 1.3, 1.1), frondMat, palmSpots.length * frondsPer);
  const nuts = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 8, 6), new THREE.MeshStandardMaterial({ color: '#6b5a2a', roughness: 0.7 }), palmSpots.length * 4);
  palmSpots.forEach(([x, z], i) => {
    const s = r(0.85, 1.25), ry = r(0, Math.PI * 2), y = heightAt(x, z) - 0.1;
    place(trunk, i, x, y, z, s, ry);
    // crown sits at the top of the leaning trunk: rotate the lean offset by ry
    const top = new THREE.Vector3(1.6 * s, 7 * s, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry).add(new THREE.Vector3(x, y, z));
    for (let f = 0; f < frondsPer; f++) {
      tmp.position.copy(top);
      tmp.rotation.set(0, (f / frondsPer) * Math.PI * 2 + r(-0.2, 0.2), 0, 'YXZ');
      tmp.rotateX(r(-0.25, 0.15));
      tmp.scale.setScalar(s * r(0.85, 1.1));
      tmp.updateMatrix();
      fronds.setMatrixAt(i * frondsPer + f, tmp.matrix);
    }
    for (let n = 0; n < 4; n++) place(nuts, i * 4 + n, top.x + Math.cos(n * 1.6) * 0.3, top.y - 0.25, top.z + Math.sin(n * 1.6) * 0.3, s, 0);
  });
  trunk.castShadow = fronds.castShadow = true;
  g.add(trunk, fronds, nuts);

  // --- banana plants near the fields' edges --------------------------------------------------------------------
  const bananaSpots = scatter(14, (x, z) => open(x, z) && Math.abs(x) > 8 && z > -30 && z < 16);
  const stem = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 1.6, 7).translate(0, 0.8, 0), new THREE.MeshStandardMaterial({ color: '#7d8a46', roughness: 0.8 }), bananaSpots.length);
  const leavesPer = 6;
  const bananaLeaf = new THREE.InstancedMesh(leafGeometry(2.6, 0.9, 0.5), addSway(new THREE.MeshStandardMaterial({ map: leafletTexture('banana'), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6 }), 0.012), bananaSpots.length * leavesPer);
  bananaSpots.forEach(([x, z], i) => {
    const s = r(0.9, 1.4), y = heightAt(x, z);
    place(stem, i, x, y, z, s, 0);
    for (let l = 0; l < leavesPer; l++) {
      tmp.position.set(x, y + 1.5 * s, z);
      tmp.rotation.set(0, (l / leavesPer) * Math.PI * 2 + r(0, 0.6), 0, 'YXZ');
      tmp.rotateX(r(-0.6, -0.2));
      tmp.scale.setScalar(s * r(0.8, 1.05));
      tmp.updateMatrix();
      bananaLeaf.setMatrixAt(i * leavesPer + l, tmp.matrix);
    }
  });
  bananaLeaf.castShadow = true;
  g.add(stem, bananaLeaf);

  // --- bushes, clustered along the field edges and river banks --------------------------------------------------
  const bushSpots = [...scatter(55, (x, z) => open(x, z)), ...scatter(25, (x, z) => clearOfDuel(x, z, 1) && riverDistance(x, z) > 3 && riverDistance(x, z) < 6 && !paddyCell(x, z))];
  const bushes = new THREE.InstancedMesh(bushGeometry(), addSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 0.01), bushSpots.length);
  bushSpots.forEach(([x, z], i) => place(bushes, i, x, heightAt(x, z) - 0.15, z, r(0.6, 1.5), r(0, 6)));
  bushes.castShadow = bushes.receiveShadow = true;
  g.add(bushes);

  // --- grass tufts over the open field (sparser on the duel path) ------------------------------------------------
  const grassSpots = scatter(2600, (x, z) => !paddyCell(x, z) && riverDistance(x, z) > 2.6 && !(Math.abs(x) < 2.2 && z > -10 && z < 9) && Math.hypot(x, z - 10) > 5, 55);
  const grass = new THREE.InstancedMesh(tuftGeometry(7, 0.55, 0.035, '#4b6e26', '#a9c060'), addSway(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }), 0.12), grassSpots.length);
  grassSpots.forEach(([x, z], i) => place(grass, i, x, heightAt(x, z), z, r(0.7, 1.5), r(0, 6)));
  grass.receiveShadow = true;
  g.add(grass);

  // --- palay: rows of rice in every paddy -------------------------------------------------------------------------
  const rice: [number, number, number][] = [];
  for (let x = PADDY.x0 + 0.8; x < PADDY.x1 - 0.6; x += 0.62) {
    for (let z = PADDY.z0 + 0.8; z < PADDY.z1 - 0.6; z += 0.55) {
      const cell = paddyCell(x, z);
      const rowDepth = (PADDY.z1 - PADDY.z0) / PADDY.rows, colWidth = (PADDY.x1 - PADDY.x0) / 3;
      const inDike = ((PADDY.z1 - z) % rowDepth) < 0.7 || ((x - PADDY.x0) % colWidth) < 0.7;
      if (cell && !inDike) rice.push([x + r(-0.08, 0.08), cell.level + 0.05, z + r(-0.08, 0.08)]);
    }
  }
  const riceMesh = new THREE.InstancedMesh(tuftGeometry(6, 0.75, 0.025, '#4d7a2c', '#d8c75a'), addSway(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 }), 0.09), rice.length);
  rice.forEach(([x, y, z], i) => place(riceMesh, i, x, y, z, r(0.85, 1.15), r(0, 6)));
  g.add(riceMesh);

  // --- river rocks ------------------------------------------------------------------------------------------------
  const rockSpots = scatter(46, (x, z) => clearOfDuel(x, z) && riverDistance(x, z) > 1.8 && riverDistance(x, z) < 3.6);
  const rocks = new THREE.InstancedMesh(rockGeometry(), new THREE.MeshStandardMaterial({ color: '#8b8576', roughness: 0.95 }), rockSpots.length);
  rockSpots.forEach(([x, z], i) => place(rocks, i, x, heightAt(x, z) - 0.05, z, r(0.25, 0.75), r(0, 6), r(-0.3, 0.3)));
  rocks.castShadow = rocks.receiveShadow = true;
  g.add(rocks);

  for (const child of g.children) (child as THREE.InstancedMesh).instanceMatrix.needsUpdate = true;
  return g;
}
