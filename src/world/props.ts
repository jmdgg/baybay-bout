// Authored landmarks: the Babaylan's ritual circle, the Aswang's scorched ground, and a bahay kubo by the palayan.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSeededRandom } from '../utils/random';
import { ENEMY_POS, heightAt, PLAYER_POS } from './shared';

const RING_TEXT = 'ᜊᜌ᜔ᜊᜌᜒᜈ᜔ ᜀᜈᜒᜆᜓ ᜊᜊᜌ᜔ᜎᜈ᜔ '; // baybayin · anito · babaylan, carved around the circle

function circleTexture(): THREE.CanvasTexture {
  const size = 512, cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!, c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 6;
  for (const radius of [236, 186, 120]) { ctx.beginPath(); ctx.arc(c, c, radius, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = '34px "Noto Sans Tagalog"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = [...RING_TEXT.repeat(2)];
  chars.forEach((ch, i) => {
    const a = (i / chars.length) * Math.PI * 2;
    ctx.save();
    ctx.translate(c + Math.cos(a) * 211, c + Math.sin(a) * 211);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
  for (let i = 0; i < 8; i++) { // eight rays like a sun disc
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * 128, c + Math.sin(a) * 128); ctx.lineTo(c + Math.cos(a) * 180, c + Math.sin(a) * 180); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function scorchTexture(): THREE.CanvasTexture {
  const size = 256, cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!, rand = createSeededRandom(3);
  for (let i = 0; i < 40; i++) {
    const x = 128 + Math.sin(i * 2.1) * 60 * rand(), y = 128 + Math.cos(i * 1.3) * 60 * rand(), rad = 20 + rand() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(30,20,22,0.35)');
    g.addColorStop(1, 'rgba(30,20,22,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function bahayKubo(): THREE.Group {
  const g = new THREE.Group();
  const bamboo = new THREE.MeshStandardMaterial({ color: '#b39a62', roughness: 0.8 });
  const thatch = new THREE.MeshStandardMaterial({ color: '#8a6f3e', roughness: 1 });
  const wall = new THREE.MeshStandardMaterial({ color: '#c9ad73', roughness: 0.95 });
  const stilts = mergeGeometries([[-1.4, -1.1], [1.4, -1.1], [-1.4, 1.1], [1.4, 1.1], [0, -1.1], [0, 1.1]].map(([x, z]) =>
    new THREE.CylinderGeometry(0.09, 0.1, 1.4, 6).translate(x, 0.7, z)));
  g.add(new THREE.Mesh(stilts, bamboo));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.15, 2.6), bamboo);
  floor.position.y = 1.45;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.5, 2.3), wall);
  body.position.y = 2.25;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2, 4, 1), thatch);
  roof.position.y = 3.95;
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.25, 1, 1);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.1), new THREE.MeshStandardMaterial({ color: '#3b2a1c', roughness: 1 }));
  door.position.set(0.3, 2.1, 1.16);
  const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.08), bamboo);
  ladder.position.set(0.3, 0.75, 1.6);
  ladder.rotation.x = -0.35;
  g.add(floor, body, roof, door, ladder);
  g.traverse(o => { o.castShadow = o.receiveShadow = true; });
  return g;
}

export function buildProps() {
  const group = new THREE.Group();
  group.name = 'props';

  // stone platform with a carved ring; the glow layer above it lights up in the cast element's colour
  const stone = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.05, 0.18, 40), new THREE.MeshStandardMaterial({ color: '#8f8778', roughness: 0.9 }));
  stone.position.set(PLAYER_POS.x, 0.09, PLAYER_POS.z);
  stone.receiveShadow = true;
  const carving = new THREE.Mesh(new THREE.CircleGeometry(1.85, 48), new THREE.MeshStandardMaterial({ map: circleTexture(), transparent: true, color: '#5a5246', roughness: 1 }));
  carving.rotation.x = -Math.PI / 2;
  carving.position.set(PLAYER_POS.x, 0.185, PLAYER_POS.z);
  const glowMat = new THREE.MeshBasicMaterial({ map: carving.material.map, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: '#ffd27a' });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1.85, 48), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(PLAYER_POS.x, 0.19, PLAYER_POS.z);
  group.add(stone, carving, glow);

  const scorch = new THREE.Mesh(new THREE.CircleGeometry(3.2, 32), new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, opacity: 0.55, depthWrite: false }));
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.set(ENEMY_POS.x, heightAt(ENEMY_POS.x, ENEMY_POS.z) + 0.04, ENEMY_POS.z);
  group.add(scorch);

  const hut = bahayKubo();
  hut.position.set(-15, heightAt(-15, 9.5), 9.5);
  hut.rotation.y = 0.5;
  group.add(hut);

  return {
    group,
    setCircleGlow(color: THREE.ColorRepresentation, intensity: number) {
      glowMat.color.set(color);
      glowMat.opacity = intensity;
    },
  };
}
