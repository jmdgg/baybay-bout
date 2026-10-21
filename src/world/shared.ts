// Shared world helpers: wind uniforms (foliage sway + spell gusts), value noise, and the terrain height field.
import * as THREE from 'three';

/** One set of wind uniforms for every swaying material; wind spells raise uGust to bend the whole field. */
export const wind = {
  uTime: { value: 0 },
  uGust: { value: 0 },
};

/** Adds height-weighted sway to a standard material (works for instanced and plain meshes). */
export function addSway(material: THREE.Material, strength: number): THREE.Material {
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = wind.uTime;
    shader.uniforms.uGust = wind.uGust;
    shader.uniforms.uSway = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uGust, uSway;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 swayRoot = vec3(0.0);
        #ifdef USE_INSTANCING
          swayRoot = instanceMatrix[3].xyz;
        #endif
        float swayH = max(position.y, 0.0) + length(position.xz) * 0.35; // tips of drooping leaves sway too
        float swayPhase = swayRoot.x * 0.37 + swayRoot.z * 0.53;
        float swayAmt = (sin(uTime * 1.7 + swayPhase) * 0.6 + sin(uTime * 3.1 + swayPhase * 1.9) * 0.25 + uGust * 2.2) * uSway;
        transformed.x += swayAmt * swayH * swayH;
        transformed.z += swayAmt * 0.45 * swayH * swayH * sin(swayPhase);`);
  };
  return material;
}

// --- noise ---------------------------------------------------------------------------------------------------
function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function noise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm = (x: number, z: number) => noise(x, z) * 0.55 + noise(x * 2.1, z * 2.1) * 0.3 + noise(x * 4.3, z * 4.3) * 0.15;

// --- map layout (metres; player at z = +6, Aswang at z = -4.5, camera looks toward -z) -------------------------
export const PLAYER_POS = new THREE.Vector3(0, 0, 6);
export const ENEMY_POS = new THREE.Vector3(0, 0, -4.5);

/** River A runs left-right behind the Aswang; river B runs front-back on the right. */
export const riverA = (x: number) => -19 + 3.2 * Math.sin(x * 0.085 + 0.6);
export const riverB = (z: number) => 15 + 2.6 * Math.sin(z * 0.11 + 1.2);
export function riverDistance(x: number, z: number): number {
  return Math.min(Math.abs(z - riverA(x)), Math.abs(x - riverB(z)));
}

/** Palayan: three terraces on the left, each a row of paddies stepping up toward the back. */
export const PADDY = { x0: -31, x1: -9, z0: -30, z1: 4, rows: 3 };
export function paddyCell(x: number, z: number): { row: number; level: number } | null {
  if (x < PADDY.x0 || x > PADDY.x1 || z < PADDY.z0 || z > PADDY.z1) return null;
  const rowDepth = (PADDY.z1 - PADDY.z0) / PADDY.rows;
  const row = Math.min(PADDY.rows - 1, Math.floor((PADDY.z1 - z) / rowDepth)); // 0 = nearest row
  return { row, level: 0.15 + row * 0.55 };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Ground height: rolling fields, flattened duel lane, carved river beds, stepped paddy terraces. */
export function heightAt(x: number, z: number): number {
  let h = (fbm(x * 0.045 + 3, z * 0.045 + 7) - 0.45) * 2.6 + Math.max(0, -z - 45) * 0.12;
  const lane = smooth(14, 6, Math.hypot(x * 0.9, Math.max(0, Math.abs(z + 1) - 7)));
  h = h * (1 - lane) + 0.02 * lane;
  const paddy = paddyCell(x, z);
  if (paddy) h = paddy.level;
  const d = riverDistance(x, z);
  return h + (-1.15 - h) * smooth(3.8, 1.3, d); // bed at a fixed depth below the water (y = -0.62)
}
