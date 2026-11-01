/* Virtual Ride 3D Réaliste — fonctions GLSL partagées par les shaders : hachages, bruits (valeur, gradient, cellulaire), bruits
   périodiques pour les textures qui se répètent sans couture, fbm, fonctions de couleur. Ce sont des chaînes de caractères insérées
   dans les shaders (three.js, GLSL ES 3.0). */

/** Hachages et bruits non périodiques (pour le monde : variations à grande échelle, vent, nuages). */
export const NOISE = /* glsl */`
float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 h32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float h13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(h13(i), h13(i + vec3(1, 0, 0)), u.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), u.x), u.y);
  float b = mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), u.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), u.x), u.y);
  return mix(a, b, u.z);
}
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 ga = h22(i) * 2.0 - 1.0, gb = h22(i + vec2(1, 0)) * 2.0 - 1.0, gc = h22(i + vec2(0, 1)) * 2.0 - 1.0, gd = h22(i + vec2(1, 1)) * 2.0 - 1.0;
  float va = dot(ga, f), vb = dot(gb, f - vec2(1, 0)), vc = dot(gc, f - vec2(0, 1)), vd = dot(gd, f - vec2(1, 1));
  return 1.4 * mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y);
}
float fbm2(vec2 p, int oct) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int k = 0; k < 8; k++) { if (k >= oct) break; s += a * gnoise(p); p = r * p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
float vfbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5, w = 0.0;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int k = 0; k < 8; k++) { if (k >= oct) break; s += a * vnoise(p); w += a; p = r * p * 2.02 + 7.3; a *= 0.5; }
  return s / w;
}
float vfbm3(vec3 p, int oct) {
  float s = 0.0, a = 0.5, w = 0.0;
  for (int k = 0; k < 6; k++) { if (k >= oct) break; s += a * vnoise3(p); w += a; p = p * 2.03 + 11.7; a *= 0.5; }
  return s / w;
}
`;

/** Bruits périodiques : période entière P (en cellules), pour des textures qui se raccordent sur leurs bords. */
export const PNOISE = /* glsl */`
vec2 pmod2(vec2 i, float P) { return mod(i, P); }
float ph12(vec2 i, float P, float seed) { return h12(pmod2(i, P) + seed * 17.13); }
vec2 ph22(vec2 i, float P, float seed) { return h22(pmod2(i, P) + seed * 17.13); }
float pvnoise(vec2 p, float P, float seed) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(ph12(i, P, seed), ph12(i + vec2(1, 0), P, seed), u.x), mix(ph12(i + vec2(0, 1), P, seed), ph12(i + vec2(1, 1), P, seed), u.x), u.y);
}
float pgnoise(vec2 p, float P, float seed) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 ga = ph22(i, P, seed) * 2.0 - 1.0, gb = ph22(i + vec2(1, 0), P, seed) * 2.0 - 1.0;
  vec2 gc = ph22(i + vec2(0, 1), P, seed) * 2.0 - 1.0, gd = ph22(i + vec2(1, 1), P, seed) * 2.0 - 1.0;
  float va = dot(ga, f), vb = dot(gb, f - vec2(1, 0)), vc = dot(gc, f - vec2(0, 1)), vd = dot(gd, f - vec2(1, 1));
  return 1.4 * mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y);
}
// fbm périodique : uv dans [0,1], P0 cellules à la première octave (doublées à chaque octave)
float pfbm(vec2 uv, float P0, int oct, float seed) {
  float s = 0.0, a = 0.5, w = 0.0, P = P0;
  for (int k = 0; k < 9; k++) { if (k >= oct) break; s += a * pgnoise(uv * P, P, seed + float(k)); w += a; P *= 2.0; a *= 0.5; }
  return s / w;
}
float pvfbm(vec2 uv, float P0, int oct, float seed) {
  float s = 0.0, a = 0.5, w = 0.0, P = P0;
  for (int k = 0; k < 9; k++) { if (k >= oct) break; s += a * pvnoise(uv * P, P, seed + float(k)); w += a; P *= 2.0; a *= 0.5; }
  return s / w;
}
// cellules de Voronoï périodiques : x = F1, y = F2, z = identifiant de la cellule (0..1), w = distance au bord (F2 - F1) ;
// jit : déplacement des germes (0 : grille régulière, 1 : aléatoire) ; stretch : cellules allongées (pavés)
vec4 pvoronoi(vec2 p, float P, float jit, float seed, vec2 stretch, out vec2 cellCenter) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0, id = 0.0;
  vec2 best = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = ph22(i + g, P, seed) * jit + 0.5 * (1.0 - jit);
    vec2 r = (g + o - f) * stretch;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = ph12(i + g, P, seed + 3.0); best = i + g + o; }
    else if (d < d2) d2 = d;
  }
  cellCenter = best;
  d1 = sqrt(d1); d2 = sqrt(d2);
  return vec4(d1, d2, id, d2 - d1);
}
// distance exacte au bord d'une cellule (Voronoï à deux passes, pour des joints de largeur constante)
vec3 pvoronoiEdge(vec2 p, float P, float jit, float seed) {
  vec2 i = floor(p), f = fract(p);
  vec2 mg, mr; float md = 8.0; float id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = ph22(i + g, P, seed) * jit + 0.5 * (1.0 - jit);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; id = ph12(i + g, P, seed + 3.0); }
  }
  md = 8.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    vec2 g = mg + vec2(float(x), float(y));
    vec2 o = ph22(i + g, P, seed) * jit + 0.5 * (1.0 - jit);
    vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return vec3(md, length(mr), id);
}
`;

/** Couleurs : sRGB ↔ linéaire, saturation, luminance. */
export const COLOR = /* glsl */`
vec3 srgb2lin(vec3 c) { return pow(c, vec3(2.2)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 sat(vec3 c, float s) { return mix(vec3(luma(c)), c, s); }
`;
