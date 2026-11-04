/* Virtual Ride 3D Réaliste — textures procédurales calculées par la carte graphique au chargement (aucun fichier image) :
   pour chaque matériau, deux couches d'un tableau de textures qui se répètent sans couture :
     A : albédo (racine carrée de la couleur linéaire, pour garder de la précision dans les sombres) et hauteur (alpha)
     B : normale (x, y), rugosité, occlusion
   Sol : herbe, herbe sèche, sous-bois, terre, roche, neige, gravier, boue. Route : enrobé, enrobé usé, pavés réguliers, pavés
   difficiles, chemin blanc, chemin de terre, herbe. Écorces : feuillu, bouleau, résineux. */
import * as THREE from 'three';
import { NOISE, PNOISE } from './glsl.js';

/** Taille (m) couverte par une répétition de chaque texture. */
export const GROUND_TILE = [2.4, 3.2, 3.0, 4.0, 7.0, 4.0, 2.2, 3.0];
export const GROUND = { GRASS: 0, DRY: 1, FOREST: 2, SOIL: 3, ROCK: 4, SNOW: 5, GRAVEL: 6, MUD: 7 };
export const ROAD_TILE = [3.0, 3.0, 2.4, 2.4, 3.0, 3.0, 3.0];
export const ROADTEX = { ASPHALT: 0, WORN: 1, COBBLES: 2, COBBLES_HARD: 3, WHITE: 4, DIRT: 5, GRASS: 6 };
export const BARK = { OAK: 0, BIRCH: 1, PINE: 2, PLASTER: 3, STONE: 4, ROOF: 5, ROOF_SLATE: 6, WOOD: 7 };

const COMMON = NOISE + PNOISE + /* glsl */`
uniform float uLayer;
uniform float uOut;
uniform float uTexel;
varying vec2 vUv;
const float TAU = 6.28318530718;
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
// brin, caillou, feuille… posés dans des cellules périodiques : renvoie la forme (0..1) et l'identifiant
float strokes(vec2 uv, float P, float seed, float len, float wid, out float id) {
  vec2 c; vec4 v = pvoronoi(uv * P, P, 1.0, seed, vec2(1.0), c);
  float a = v.z * TAU;
  vec2 d = vec2(cos(a), sin(a));
  vec2 q = uv * P - c;
  float al = dot(q, d), ac = dot(q, vec2(-d.y, d.x));
  id = v.z;
  float t = clamp(al / len * 0.5 + 0.5, 0.0, 1.0);
  return exp(-ac * ac / (wid * wid * (1.0 - 0.8 * t))) * smoothstep(1.0, 0.85, abs(al / len)) ;
}
`;

/* Chaque matériau : height(uv) → hauteur 0..1 ; surface(uv, h, out albédo linéaire, out rugosité, out occlusion). */
const GROUND_SRC = /* glsl */`
float hGrass(vec2 uv) {
  float id, s = 0.0;
  for (int k = 0; k < 5; k++) s = max(s, strokes(uv, 34.0 + float(k) * 9.0, float(k) * 3.1, 0.55, 0.07, id) * (0.55 + 0.45 * fract(id * 7.3)));
  return 0.25 + 0.75 * s + 0.1 * pfbm(uv, 8.0, 4, 1.0);
}
void sGrass(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float pch = pfbm(uv, 3.0, 4, 2.0) * 0.5 + 0.5;
  float dry = smoothstep(0.55, 0.85, pvfbm(uv, 5.0, 3, 9.0));
  vec3 soil = vec3(0.045, 0.040, 0.022);
  vec3 g1 = mix(vec3(0.060, 0.115, 0.025), vec3(0.105, 0.150, 0.035), pch);
  vec3 g2 = mix(g1, vec3(0.180, 0.170, 0.060), dry * 0.7);
  float b = smoothstep(0.32, 0.75, h);
  A = mix(soil, g2 * (0.75 + 0.5 * h), b);
  R = mix(0.95, 0.78, b);
  O = mix(0.55, 1.0, b);
}
float hDry(vec2 uv) {
  float id, s = 0.0;
  for (int k = 0; k < 4; k++) s = max(s, strokes(uv, 26.0 + float(k) * 7.0, 11.0 + float(k), 0.7, 0.06, id) * (0.5 + 0.5 * fract(id * 5.1)));
  return 0.2 + 0.6 * s + 0.2 * pfbm(uv, 6.0, 4, 3.0);
}
void sDry(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float pch = pfbm(uv, 4.0, 4, 4.0) * 0.5 + 0.5;
  vec3 soil = vec3(0.075, 0.062, 0.040);
  vec3 straw = mix(vec3(0.200, 0.170, 0.075), vec3(0.135, 0.150, 0.060), pch);
  float b = smoothstep(0.3, 0.7, h);
  A = mix(soil, straw * (0.8 + 0.45 * h), b);
  R = 0.9; O = mix(0.6, 1.0, b);
}
float hForest(vec2 uv) {
  float id, s = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 c; vec4 v = pvoronoi(uv * (14.0 + float(k) * 5.0), 14.0 + float(k) * 5.0, 1.0, 20.0 + float(k), vec2(1.0, 1.6), c);
    s = max(s, smoothstep(0.42, 0.18, v.x) * (0.4 + 0.6 * v.z));
  }
  float twig = 0.0;
  for (int k = 0; k < 2; k++) twig = max(twig, strokes(uv, 9.0 + float(k) * 4.0, 40.0 + float(k), 0.9, 0.025, id));
  return 0.15 + 0.6 * s + 0.35 * twig;
}
void sForest(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float id; vec2 c; vec4 v = pvoronoi(uv * 14.0, 14.0, 1.0, 20.0, vec2(1.0, 1.6), c);
  vec3 leafA = vec3(0.14, 0.075, 0.030), leafB = vec3(0.085, 0.060, 0.030), leafC = vec3(0.17, 0.12, 0.05);
  vec3 leaf = mix(mix(leafA, leafB, v.z), leafC, step(0.8, fract(v.z * 9.1)));
  vec3 soil = vec3(0.030, 0.022, 0.014);
  float moss = smoothstep(0.55, 0.8, pvfbm(uv, 4.0, 4, 22.0));
  A = mix(soil, leaf, smoothstep(0.2, 0.45, h));
  A = mix(A, vec3(0.05, 0.08, 0.02), moss * 0.7);
  R = 0.88; O = mix(0.5, 1.0, smoothstep(0.1, 0.5, h));
}
float hSoil(vec2 uv) {
  vec2 c; vec4 v = pvoronoi(uv * 22.0, 22.0, 1.0, 30.0, vec2(1.0), c);
  float clod = smoothstep(0.0, 0.35, v.w) * (0.5 + 0.5 * v.z);
  vec4 st = pvoronoi(uv * 60.0, 60.0, 1.0, 31.0, vec2(1.0), c);
  float stone = smoothstep(0.32, 0.12, st.x) * step(0.82, st.z);
  return 0.3 + 0.35 * clod + 0.25 * pfbm(uv, 6.0, 5, 32.0) + 0.35 * stone;
}
void sSoil(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float var = pfbm(uv, 3.0, 4, 33.0) * 0.5 + 0.5;
  vec2 c; vec4 st = pvoronoi(uv * 60.0, 60.0, 1.0, 31.0, vec2(1.0), c);
  float stone = smoothstep(0.32, 0.12, st.x) * step(0.82, st.z);
  A = mix(vec3(0.085, 0.058, 0.036), vec3(0.135, 0.095, 0.060), var) * (0.75 + 0.45 * h);
  A = mix(A, vec3(0.22, 0.20, 0.17) * (0.7 + 0.5 * fract(st.z * 13.0)), stone);
  R = mix(0.94, 0.7, stone); O = mix(0.65, 1.0, h);
}
float hRock(vec2 uv) {
  float strata = pfbm(vec2(uv.x * 1.0, uv.y * 4.0), 3.0, 5, 40.0);
  vec3 e = pvoronoiEdge(uv * 6.0, 6.0, 1.0, 41.0);
  float crack = smoothstep(0.0, 0.05, e.x);
  vec3 e2 = pvoronoiEdge(uv * 17.0, 17.0, 1.0, 42.0);
  float crack2 = smoothstep(0.0, 0.04, e2.x);
  float bumps = pfbm(uv, 8.0, 6, 43.0);
  return clamp(0.45 + 0.25 * strata + 0.25 * bumps * crack, 0.0, 1.0) * mix(0.55, 1.0, crack) * mix(0.8, 1.0, crack2);
}
void sRock(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float var = pfbm(uv, 2.0, 5, 44.0) * 0.5 + 0.5;
  vec3 e = pvoronoiEdge(uv * 6.0, 6.0, 1.0, 41.0);
  vec3 base = mix(vec3(0.16, 0.155, 0.15), vec3(0.27, 0.255, 0.235), var);
  base *= 0.85 + 0.3 * fract(e.z * 3.7);
  float lichen = smoothstep(0.62, 0.78, pvfbm(uv, 9.0, 4, 45.0)) * smoothstep(0.3, 0.7, h);
  A = mix(base * (0.7 + 0.5 * h), vec3(0.28, 0.27, 0.16), lichen * 0.6);
  float dark = smoothstep(0.08, 0.0, e.x);
  A *= 1.0 - 0.55 * dark;
  R = mix(0.82, 0.92, var); O = mix(0.45, 1.0, smoothstep(0.0, 0.08, e.x));
}
float hSnow(vec2 uv) { return 0.5 + 0.3 * pfbm(uv, 3.0, 5, 50.0) + 0.1 * pfbm(uv, 24.0, 3, 51.0); }
void sSnow(vec2 uv, float h, out vec3 A, out float R, out float O) {
  A = vec3(0.86, 0.89, 0.93) * (0.92 + 0.1 * h);
  float sparkle = step(0.985, ph12(floor(uv * 512.0), 512.0, 52.0));
  R = mix(0.55, 0.25, sparkle); O = 1.0;
}
float hGravel(vec2 uv) {
  float s = 0.0;
  for (int k = 0; k < 3; k++) {
    vec2 c; vec4 v = pvoronoi(uv * (34.0 + float(k) * 21.0), 34.0 + float(k) * 21.0, 1.0, 60.0 + float(k), vec2(1.0), c);
    s = max(s, sqrt(max(0.0, 1.0 - v.x * v.x * 3.2)) * (0.55 + 0.45 * v.z) * (1.0 - 0.25 * float(k)));
  }
  return 0.15 + 0.85 * s;
}
void sGravel(vec2 uv, float h, out vec3 A, out float R, out float O) {
  vec2 c; vec4 v = pvoronoi(uv * 34.0, 34.0, 1.0, 60.0, vec2(1.0), c);
  vec3 st = mix(vec3(0.30, 0.28, 0.24), vec3(0.44, 0.41, 0.36), v.z);
  st = mix(st, vec3(0.20, 0.18, 0.16), step(0.85, fract(v.z * 7.0)));
  A = mix(vec3(0.12, 0.10, 0.08), st, smoothstep(0.2, 0.5, h));
  R = 0.86; O = mix(0.5, 1.0, smoothstep(0.15, 0.5, h));
}
float hMud(vec2 uv) { return 0.45 + 0.35 * pfbm(uv, 4.0, 5, 70.0) + 0.1 * pfbm(uv, 30.0, 3, 71.0); }
void sMud(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float var = pfbm(uv, 3.0, 3, 72.0) * 0.5 + 0.5;
  A = mix(vec3(0.050, 0.038, 0.025), vec3(0.085, 0.065, 0.040), var) * (0.8 + 0.4 * h);
  float puddle = smoothstep(0.42, 0.36, h);
  R = mix(0.7, 0.12, puddle); O = 1.0;
}
float height(vec2 uv) {
  int L = int(uLayer + 0.5);
  if (L == 0) return hGrass(uv);
  if (L == 1) return hDry(uv);
  if (L == 2) return hForest(uv);
  if (L == 3) return hSoil(uv);
  if (L == 4) return hRock(uv);
  if (L == 5) return hSnow(uv);
  if (L == 6) return hGravel(uv);
  return hMud(uv);
}
void surface(vec2 uv, float h, out vec3 A, out float R, out float O) {
  int L = int(uLayer + 0.5);
  if (L == 0) sGrass(uv, h, A, R, O);
  else if (L == 1) sDry(uv, h, A, R, O);
  else if (L == 2) sForest(uv, h, A, R, O);
  else if (L == 3) sSoil(uv, h, A, R, O);
  else if (L == 4) sRock(uv, h, A, R, O);
  else if (L == 5) sSnow(uv, h, A, R, O);
  else if (L == 6) sGravel(uv, h, A, R, O);
  else sMud(uv, h, A, R, O);
}
// relief (m) d'une hauteur 0..1 sur une répétition
float bumpScale() { int L = int(uLayer + 0.5); return L == 4 ? 0.35 : L == 6 ? 0.05 : L == 5 ? 0.06 : L == 0 ? 0.035 : 0.05; }
float tileSize() { int L = int(uLayer + 0.5); return L == 0 ? 2.4 : L == 1 ? 3.2 : L == 2 ? 3.0 : L == 3 ? 4.0 : L == 4 ? 7.0 : L == 5 ? 4.0 : L == 6 ? 2.2 : 3.0; }
`;

const ROAD_SRC = /* glsl */`
// enrobé : granulats de tailles et de teintes variées dans le liant
float aggregate(vec2 uv, float seed, out float tone) {
  float s = 0.0; tone = 0.5;
  for (int k = 0; k < 3; k++) {
    float P = 90.0 + float(k) * 70.0;
    vec2 c; vec4 v = pvoronoi(uv * P, P, 1.0, seed + float(k), vec2(1.0), c);
    float r = 0.42 - 0.08 * float(k);
    float stone = smoothstep(r, r - 0.18, v.x);
    if (stone * (1.0 - 0.2 * float(k)) > s) { s = stone * (1.0 - 0.2 * float(k)); tone = v.z; }
  }
  return s;
}
float hAsphalt(vec2 uv) { float t; return 0.35 + 0.5 * aggregate(uv, 100.0, t) + 0.15 * pfbm(uv, 12.0, 4, 101.0); }
void sAsphalt(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float t; float s = aggregate(uv, 100.0, t);
  float var = pfbm(uv, 3.0, 4, 102.0) * 0.5 + 0.5;
  vec3 binder = mix(vec3(0.022), vec3(0.034), var);
  vec3 stone = mix(vec3(0.05), vec3(0.17, 0.165, 0.16), t * t);
  A = mix(binder, stone, s);
  R = mix(0.92, 0.72, s); O = mix(0.75, 1.0, h);
}
float hWorn(vec2 uv) {
  float t; float s = aggregate(uv, 110.0, t);
  vec3 e = pvoronoiEdge(uv * 3.0, 3.0, 1.0, 111.0);
  float crack = smoothstep(0.0, 0.012, e.x) * 0.5 + 0.5 * step(0.55, pvfbm(uv, 4.0, 3, 112.0));
  return (0.35 + 0.45 * s + 0.2 * pfbm(uv, 10.0, 4, 113.0)) * mix(0.3, 1.0, crack);
}
void sWorn(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float t; float s = aggregate(uv, 110.0, t);
  float var = pfbm(uv, 2.0, 4, 114.0) * 0.5 + 0.5;
  vec3 binder = mix(vec3(0.045), vec3(0.075, 0.072, 0.068), var);
  vec3 stone = mix(vec3(0.08), vec3(0.22, 0.21, 0.20), t);
  A = mix(binder, stone, s * 0.9);
  float patchM = smoothstep(0.6, 0.62, pvfbm(uv * vec2(1.0, 0.5), 2.0, 2, 115.0));
  A = mix(A, vec3(0.018), patchM);
  vec3 e = pvoronoiEdge(uv * 3.0, 3.0, 1.0, 111.0);
  A *= mix(0.35, 1.0, smoothstep(0.0, 0.012, e.x));
  R = mix(0.94, 0.75, s); O = mix(0.5, 1.0, h);
}
// pavés : rangées de pierres taillées (jit faible) ou irrégulières, joints de sable, de terre ou d'herbe
float cobble(vec2 uv, float jit, float seed, out vec3 info) {
  vec2 p = uv * 16.0;
  p.x += 0.5 * mod(floor(p.y), 2.0);
  vec2 c; vec4 v = pvoronoi(p, 16.0, jit, seed, vec2(1.0, 1.25), c);
  vec2 f = fract(p) - 0.5;
  float boxd = max(abs(f.x) * 2.0, abs(f.y) * 2.0);
  float rounded = mix(1.0 - boxd, v.w * 1.6, jit);
  info = vec3(v.z, rounded, 0.0);
  return smoothstep(0.0, mix(0.25, 0.4, jit), rounded);
}
float hCobbles(vec2 uv, float jit, float seed) {
  vec3 info; float s = cobble(uv, jit, seed, info);
  float dome = s * (0.55 + 0.25 * info.x);
  return 0.08 + 0.85 * dome + 0.07 * pfbm(uv, 24.0, 3, seed + 1.0) * s;
}
void sCobbles(vec2 uv, float h, float jit, float seed, out vec3 A, out float R, out float O) {
  vec3 info; float s = cobble(uv, jit, seed, info);
  vec3 stone = mix(vec3(0.15, 0.14, 0.13), vec3(0.30, 0.27, 0.23), info.x);
  stone = mix(stone, vec3(0.20, 0.16, 0.12), step(0.8, fract(info.x * 11.0)) * 0.6);
  stone *= 0.85 + 0.25 * pfbm(uv, 20.0, 3, seed + 2.0);
  float grassy = jit > 0.5 ? smoothstep(0.45, 0.7, pvfbm(uv, 6.0, 3, seed + 3.0)) : 0.0;
  vec3 joint = mix(vec3(0.10, 0.085, 0.06), vec3(0.06, 0.09, 0.03), grassy);
  A = mix(joint, stone, s);
  R = mix(0.95, mix(0.62, 0.8, info.x), s); O = mix(0.45, 1.0, s);
}
float hWhite(vec2 uv) {
  float s = 0.0;
  for (int k = 0; k < 2; k++) {
    vec2 c; vec4 v = pvoronoi(uv * (50.0 + float(k) * 40.0), 50.0 + float(k) * 40.0, 1.0, 140.0 + float(k), vec2(1.0), c);
    s = max(s, smoothstep(0.35, 0.15, v.x) * step(0.55, v.z));
  }
  return 0.4 + 0.25 * pfbm(uv, 6.0, 5, 141.0) + 0.35 * s;
}
void sWhite(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float var = pfbm(uv, 3.0, 4, 142.0) * 0.5 + 0.5;
  A = mix(vec3(0.42, 0.40, 0.35), vec3(0.58, 0.56, 0.50), var) * (0.82 + 0.3 * h);
  R = 0.92; O = mix(0.7, 1.0, h);
}
float hDirt(vec2 uv) { vec2 c; return 0.4 + 0.35 * pfbm(uv, 5.0, 6, 150.0) + 0.25 * smoothstep(0.3, 0.1, pvoronoi(uv * 40.0, 40.0, 1.0, 151.0, vec2(1.0), c).x); }
void sDirt(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float var = pfbm(uv, 3.0, 4, 152.0) * 0.5 + 0.5;
  A = mix(vec3(0.12, 0.085, 0.052), vec3(0.20, 0.15, 0.095), var) * (0.8 + 0.35 * h);
  R = 0.9; O = mix(0.7, 1.0, h);
}
float hGrassPath(vec2 uv) {
  float id, s = 0.0;
  for (int k = 0; k < 4; k++) s = max(s, strokes(uv, 30.0 + float(k) * 9.0, 160.0 + float(k), 0.55, 0.07, id));
  float bare = smoothstep(0.45, 0.65, pvfbm(uv, 4.0, 4, 165.0));
  return mix(0.2 + 0.75 * s, 0.3 + 0.2 * pfbm(uv, 12.0, 3, 166.0), bare);
}
void sGrassPath(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float bare = smoothstep(0.45, 0.65, pvfbm(uv, 4.0, 4, 165.0));
  vec3 g = mix(vec3(0.05, 0.09, 0.02), vec3(0.12, 0.15, 0.04), h);
  A = mix(g, vec3(0.16, 0.13, 0.08), bare * 0.8);
  R = 0.9; O = mix(0.6, 1.0, h);
}
float height(vec2 uv) {
  int L = int(uLayer + 0.5);
  if (L == 0) return hAsphalt(uv);
  if (L == 1) return hWorn(uv);
  if (L == 2) return hCobbles(uv, 0.12, 120.0);
  if (L == 3) return hCobbles(uv, 0.75, 130.0);
  if (L == 4) return hWhite(uv);
  if (L == 5) return hDirt(uv);
  return hGrassPath(uv);
}
void surface(vec2 uv, float h, out vec3 A, out float R, out float O) {
  int L = int(uLayer + 0.5);
  if (L == 0) sAsphalt(uv, h, A, R, O);
  else if (L == 1) sWorn(uv, h, A, R, O);
  else if (L == 2) sCobbles(uv, h, 0.12, 120.0, A, R, O);
  else if (L == 3) sCobbles(uv, h, 0.75, 130.0, A, R, O);
  else if (L == 4) sWhite(uv, h, A, R, O);
  else if (L == 5) sDirt(uv, h, A, R, O);
  else sGrassPath(uv, h, A, R, O);
}
float bumpScale() { int L = int(uLayer + 0.5); return L == 2 || L == 3 ? 0.035 : L == 1 ? 0.012 : 0.008; }
float tileSize() { return uLayer > 1.5 && uLayer < 3.5 ? 2.4 : 3.0; }
`;

const BARK_SRC = /* glsl */`
float hOak(vec2 uv) {
  float ridges = pfbm(vec2(uv.x * 6.0, uv.y * 1.2), 2.0, 5, 200.0);
  vec3 e = pvoronoiEdge(vec2(uv.x * 7.0, uv.y * 2.0), 7.0, 0.9, 201.0);
  return clamp(0.5 + 0.35 * ridges, 0.0, 1.0) * smoothstep(0.0, 0.08, e.x);
}
void sOak(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float var = pfbm(uv, 3.0, 3, 202.0) * 0.5 + 0.5;
  A = mix(vec3(0.055, 0.045, 0.035), vec3(0.13, 0.115, 0.095), var) * (0.45 + 0.75 * h);
  float moss = smoothstep(0.6, 0.75, pvfbm(uv, 4.0, 3, 203.0));
  A = mix(A, vec3(0.06, 0.09, 0.025), moss * 0.6);
  R = 0.92; O = mix(0.4, 1.0, h);
}
float hBirch(vec2 uv) { return 0.6 + 0.2 * pfbm(vec2(uv.x * 2.0, uv.y * 8.0), 2.0, 4, 210.0); }
void sBirch(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float marks = smoothstep(0.62, 0.66, pvfbm(vec2(uv.x * 1.0, uv.y * 10.0), 4.0, 3, 211.0));
  float lent = smoothstep(0.7, 0.72, pvfbm(vec2(uv.x * 0.5, uv.y * 24.0), 6.0, 2, 212.0));
  A = vec3(0.62, 0.60, 0.56) * (0.85 + 0.15 * h);
  A = mix(A, vec3(0.03), max(marks, lent * 0.8));
  R = 0.7; O = 1.0;
}
float hPine(vec2 uv) {
  vec3 e = pvoronoiEdge(vec2(uv.x * 5.0, uv.y * 3.0), 5.0, 1.0, 220.0);
  return smoothstep(0.0, 0.06, e.x) * (0.6 + 0.4 * pfbm(uv, 6.0, 3, 221.0));
}
void sPine(vec2 uv, float h, out vec3 A, out float R, out float O) {
  vec3 e = pvoronoiEdge(vec2(uv.x * 5.0, uv.y * 3.0), 5.0, 1.0, 220.0);
  A = mix(vec3(0.13, 0.065, 0.035), vec3(0.24, 0.13, 0.07), e.z) * (0.45 + 0.7 * h);
  R = 0.9; O = mix(0.4, 1.0, h);
}
// enduit de façade (crépi)
float hPlaster(vec2 uv) { return 0.5 + 0.3 * pfbm(uv, 40.0, 3, 230.0) + 0.2 * pfbm(uv, 4.0, 4, 231.0); }
void sPlaster(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float stain = smoothstep(0.55, 0.85, pvfbm(vec2(uv.x * 2.0, uv.y * 0.6), 3.0, 4, 232.0));
  A = vec3(0.55, 0.52, 0.47) * (0.9 + 0.15 * h) * (1.0 - 0.25 * stain);
  R = 0.93; O = 1.0;
}
// moellons de pierre (murs de village, ponts)
float hStone(vec2 uv) {
  vec2 p = uv * vec2(5.0, 10.0);
  p.x += 0.5 * mod(floor(p.y), 2.0) + 0.2 * h12(vec2(mod(floor(p.y), 10.0), 3.0));
  vec2 f = fract(p) - 0.5;
  float b = 1.0 - max(abs(f.x) * 2.0, abs(f.y) * 2.0);
  return smoothstep(0.0, 0.18, b) * (0.7 + 0.3 * pfbm(uv, 16.0, 3, 240.0));
}
void sStone(vec2 uv, float h, out vec3 A, out float R, out float O) {
  vec2 p = uv * vec2(5.0, 10.0); p.x += 0.5 * mod(floor(p.y), 2.0) + 0.2 * h12(vec2(mod(floor(p.y), 10.0), 3.0));
  float id = h12(mod(floor(p), vec2(5.0, 10.0)) + 7.0);
  A = mix(vec3(0.30, 0.27, 0.22), vec3(0.45, 0.41, 0.34), id) * (0.6 + 0.5 * h);
  A = mix(vec3(0.17, 0.16, 0.14), A, smoothstep(0.05, 0.2, h));
  R = 0.9; O = mix(0.5, 1.0, h);
}
// tuiles canal (toits du Sud) et tuiles plates
float hRoof(vec2 uv) {
  vec2 p = uv * vec2(8.0, 6.0);
  float row = floor(p.y);
  p.x += 0.5 * mod(row, 2.0);
  float wave = 0.5 + 0.5 * cos(fract(p.x) * TAU);
  float lap = smoothstep(0.0, 0.9, fract(p.y));
  return wave * 0.6 + lap * 0.4;
}
void sRoof(vec2 uv, float h, out vec3 A, out float R, out float O) {
  vec2 p = uv * vec2(8.0, 6.0); p.x += 0.5 * mod(floor(p.y), 2.0);
  float id = h12(mod(floor(p), vec2(8.0, 6.0)) + 13.0);
  A = mix(vec3(0.28, 0.085, 0.045), vec3(0.42, 0.16, 0.08), id) * (0.55 + 0.5 * h);
  float lichen = smoothstep(0.6, 0.8, pvfbm(uv, 3.0, 4, 250.0));
  A = mix(A, vec3(0.25, 0.22, 0.14), lichen * 0.5);
  R = 0.75; O = mix(0.45, 1.0, h);
}
float hSlate(vec2 uv) {
  vec2 p = uv * vec2(9.0, 14.0); p.x += 0.5 * mod(floor(p.y), 2.0);
  vec2 f = fract(p);
  return smoothstep(0.0, 0.08, f.x) * smoothstep(1.0, 0.92, f.x) * (0.3 + 0.7 * f.y);
}
void sSlate(vec2 uv, float h, out vec3 A, out float R, out float O) {
  vec2 p = uv * vec2(9.0, 14.0); p.x += 0.5 * mod(floor(p.y), 2.0);
  float id = h12(mod(floor(p), vec2(9.0, 14.0)) + 17.0);
  A = mix(vec3(0.03, 0.034, 0.042), vec3(0.06, 0.064, 0.072), id) * (0.7 + 0.4 * h);
  R = 0.72; O = mix(0.5, 1.0, h);
}
// planches (volets, portes, chalets)
float hWood(vec2 uv) { float pl = fract(uv.x * 8.0); return smoothstep(0.0, 0.06, pl) * smoothstep(1.0, 0.94, pl) * (0.8 + 0.2 * pfbm(vec2(uv.x * 8.0, uv.y * 1.5), 4.0, 3, 260.0)); }
void sWood(vec2 uv, float h, out vec3 A, out float R, out float O) {
  float grain = pfbm(vec2(uv.x * 30.0, uv.y * 2.0), 4.0, 4, 261.0) * 0.5 + 0.5;
  A = mix(vec3(0.16, 0.10, 0.055), vec3(0.28, 0.18, 0.10), grain) * (0.6 + 0.5 * h);
  R = 0.8; O = mix(0.5, 1.0, h);
}
float height(vec2 uv) {
  int L = int(uLayer + 0.5);
  if (L == 0) return hOak(uv);
  if (L == 1) return hBirch(uv);
  if (L == 2) return hPine(uv);
  if (L == 3) return hPlaster(uv);
  if (L == 4) return hStone(uv);
  if (L == 5) return hRoof(uv);
  if (L == 6) return hSlate(uv);
  return hWood(uv);
}
void surface(vec2 uv, float h, out vec3 A, out float R, out float O) {
  int L = int(uLayer + 0.5);
  if (L == 0) sOak(uv, h, A, R, O);
  else if (L == 1) sBirch(uv, h, A, R, O);
  else if (L == 2) sPine(uv, h, A, R, O);
  else if (L == 3) sPlaster(uv, h, A, R, O);
  else if (L == 4) sStone(uv, h, A, R, O);
  else if (L == 5) sRoof(uv, h, A, R, O);
  else if (L == 6) sSlate(uv, h, A, R, O);
  else sWood(uv, h, A, R, O);
}
float bumpScale() { int L = int(uLayer + 0.5); return L == 0 || L == 2 ? 0.05 : L == 4 ? 0.06 : L == 5 ? 0.05 : 0.01; }
float tileSize() { return 1.6; }
`;

const MAIN = /* glsl */`
void main() {
  vec2 uv = vUv;
  float h = height(uv);
  if (uOut < 0.5) {
    vec3 A; float R, O;
    surface(uv, h, A, R, O);
    gl_FragColor = vec4(sqrt(clamp(A, 0.0, 1.0)), h);
  } else {
    float e = uTexel;
    float hx = height(uv + vec2(e, 0.0)) - height(uv - vec2(e, 0.0));
    float hy = height(uv + vec2(0.0, e)) - height(uv - vec2(0.0, e));
    float k = bumpScale() / (2.0 * e * tileSize());
    vec3 n = normalize(vec3(-hx * k, -hy * k, 1.0));
    vec3 A; float R, O;
    surface(uv, h, A, R, O);
    gl_FragColor = vec4(n.xy * 0.5 + 0.5, R, O);
  }
}
`;

function bake(renderer, size, layers, src) {
  const opts = {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false,
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: THREE.NoColorSpace,
  };
  const rtA = new THREE.WebGLArrayRenderTarget(size, size, layers, opts);
  const rtB = new THREE.WebGLArrayRenderTarget(size, size, layers, opts);
  for (const rt of [rtA, rtB]) {
    Object.assign(rt.texture, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, anisotropy: renderer.capabilities.getMaxAnisotropy() });
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: { uLayer: { value: 0 }, uOut: { value: 0 }, uTexel: { value: 1 / size } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: COMMON + src + MAIN,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  const prevAuto = renderer.autoClear;
  renderer.autoClear = false;
  for (let l = 0; l < layers; l++) {
    for (const [rt, out] of [[rtA, 0], [rtB, 1]]) {
      mat.uniforms.uLayer.value = l;
      mat.uniforms.uOut.value = out;
      renderer.setRenderTarget(rt, l);
      renderer.render(scene, cam);
    }
  }
  renderer.setRenderTarget(prev);
  renderer.autoClear = prevAuto;
  mat.dispose(); quad.geometry.dispose();
  return { A: rtA.texture, B: rtB.texture, rts: [rtA, rtB] };
}

/** Calcule toutes les textures (quelques centaines de millisecondes) : {ground, road, bark}, chacune {A, B}. */
export function bakeAll(renderer, quality) {
  const big = quality === 'ultra' ? 2048 : 1024;
  return {
    ground: bake(renderer, big, 8, GROUND_SRC),
    road: bake(renderer, big, 7, ROAD_SRC),
    bark: bake(renderer, 512, 8, BARK_SRC),
  };
}

/** Fonctions GLSL d'échantillonnage des tableaux de textures (albédo et normale décodés). */
export const SAMPLE = /* glsl */`
vec4 texA(sampler2DArray t, vec2 uv, float layer) { vec4 a = texture(t, vec3(uv, layer)); return vec4(a.rgb * a.rgb, a.a); }
vec4 texB(sampler2DArray t, vec2 uv, float layer) { vec4 b = texture(t, vec3(uv, layer)); return vec4(b.xy * 2.0 - 1.0, b.z, b.w); }
`;
