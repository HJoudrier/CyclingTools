"""Wattlas — vélo de route paramétrique pour Unity, construit par Blender.

Le script construit un vélo complet à partir de sa géométrie (stack, reach, angles, bases, déport…) :
cadre, fourche, poste de pilotage, selle, roues (jante, pneu, moyeu, rayons, disque), pédalier,
cassette, chaîne et dérailleurs. Il l'exporte pour Unity en .glb et/ou .fbx, avec :

  - les pièces mobiles sur des pivots séparés (direction, roues, pédalier, pédales) ;
  - trois niveaux de détail par pièce (suffixes _LOD0, _LOD1, _LOD2, reconnus par Unity) ;
  - un seul matériau par vélo : une petite palette de 4 × 4 couleurs (couleur + métal / rugosité),
    pour peu d'appels de dessin (casque Meta Quest autonome) ;
  - des ancres (objets vides) pour la cinématique inverse du cycliste : selle, mains, pieds.

Lancer (Blender 4.2 ou plus récent) :
  blender -b -P velo_route.py -- --cadre aero --couleur "#C8102E"
ou, avec le module Python de Blender (pip install bpy) :
  python velo_route.py --cadre aero --couleur "#C8102E"

Options : python velo_route.py --aide (ou blender -b -P velo_route.py -- --aide).

Repère : 1 unité = 1 mètre. Dans Blender, le vélo regarde vers -Y, Z en haut ; une fois importé dans
Unity, il regarde vers +Z (axe bleu), Y en haut, la transmission à droite (+X). L'origine est au sol,
au milieu de l'empattement : posé sur une pente, les deux roues touchent la route.
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------------------------------
# Repère de travail : « repère cycliste » (x vers la droite du cycliste, y vers l'avant, z vers le haut).
# Converti en repère Blender (vélo tourné vers -Y) à la création des maillages.

LAT = Vector((1.0, 0.0, 0.0))   # vers la droite du cycliste (côté transmission)
AV = Vector((0.0, 1.0, 0.0))    # vers l'avant
HAUT = Vector((0.0, 0.0, 1.0))  # vers le haut
R_JANTE = 0.311                 # rayon du siège du pneu (ETRTO 622, roues de 700)
PAS_CHAINE = 0.0127             # pas d'une chaîne de vélo (1/2 pouce)


def vers_blender(v):
    """Repère cycliste → repère Blender (rotation de 180° autour de Z : le vélo regarde vers -Y)."""
    return Vector((-v.x, -v.y, v.z))


def vers_unity(vb):
    """Repère Blender → repère Unity (même conversion que l'import glTF : +Z devant, +X à droite)."""
    return [round(-vb.x, 4), round(vb.z, 4), round(-vb.y, 4)]


# ---------------------------------------------------------------------------------------------------
# Catalogue : mêmes identifiants que le magasin de Wattlas (Commun/js/engine/catalog.js) et que les
# vélos des vues 3D (VirtualRide3DRealiste/monde/js/bike.js). Cotes d'un cadre de taille 56.

GEO_BASE = {
    "stack": 0.565,            # boîtier → haut de la douille, verticalement (m)
    "reach": 0.390,            # boîtier → haut de la douille, horizontalement (m)
    "angle_direction": 73.0,   # angle de la douille avec l'horizontale (°)
    "angle_selle": 73.5,       # angle du tube de selle avec l'horizontale (°)
    "douille": 0.150,          # longueur de la douille (m)
    "bases": 0.408,            # longueur des bases (boîtier → axe arrière) (m)
    "drop_boitier": 0.070,     # le boîtier est sous la ligne des axes de (m)
    "deport": 0.045,           # déport de la fourche (m)
    "tube_selle": 0.530,       # boîtier → haut du tube de selle (m)
    "k": 1.0,                  # épaisseur des tubes (× sur le rayon)
    "profil": 1.0,             # profondeur des tubes aéro (1 = tubes ronds)
    "haubans": 0.92,           # hauteur de jonction des haubans sur le tube de selle (fraction)
    "cintre": "drop",          # "drop" (cintre route) ou "aero" (dessus plat profilé)
    "evasement": 0.0,          # évasement du bas du cintre (gravel) (m)
}
CADRES = {
    "classic": {},
    "alu": {"k": 1.15},
    "endurance": {"stack": 0.595, "reach": 0.380, "angle_direction": 72.5, "douille": 0.180, "bases": 0.415, "drop_boitier": 0.075},
    "climber": {"stack": 0.560, "reach": 0.392, "k": 0.85},
    "aero": {"stack": 0.555, "reach": 0.395, "angle_direction": 73.5, "k": 0.9, "profil": 2.2, "haubans": 0.62, "cintre": "aero"},
    "gravel": {"stack": 0.590, "reach": 0.385, "angle_direction": 71.5, "douille": 0.165, "bases": 0.425, "drop_boitier": 0.072,
               "deport": 0.050, "evasement": 0.045, "k": 1.05},
}
ROUES = {  # profil = hauteur de jante (m)
    "box": {"profil": 0.018, "matiere": "alu", "rayons": 32, "croises": True},
    "alu": {"profil": 0.025, "matiere": "metal_sombre", "rayons": 24, "croises": True},
    "climb": {"profil": 0.030, "matiere": "carbone", "rayons": 24},
    "c45": {"profil": 0.045, "matiere": "carbone", "rayons": 20},
    "c65": {"profil": 0.060, "matiere": "carbone", "rayons": 20},
    "c80": {"profil": 0.080, "matiere": "carbone", "rayons": 18},
    "gravel": {"profil": 0.025, "matiere": "metal_sombre", "rayons": 28, "croises": True, "large": True},
    "disc": {"avant": "c80", "arriere": "lenticulaire"},
}
PNEUS = {  # largeur en mm ; flanc = flancs beiges
    "race": {"largeur": 25, "flanc": True},
    "road": {"largeur": 28},
    "tubeless": {"largeur": 30},
    "training": {"largeur": 32},
    "gravel": {"largeur": 40, "flanc": True},
}

PARAMETRES = {
    "nom": None,                 # nom de l'objet racine et des fichiers (défaut : Velo_<Cadre>)
    "cadre": "aero",
    "roues": "c45",
    "pneus": "road",
    "taille_cm": 56,             # taille du cadre : ajuste stack, reach, douille et tube de selle
    "geometrie": {},             # cotes qui remplacent celles du cadre (clés de GEO_BASE)
    "couleur": "#C8102E",        # peinture du cadre
    "accent": "#F2F2F2",         # couleur d'accent (logos, liserés)
    "hauteur_selle": 0.72,       # axe du boîtier → dessus de la selle, le long du tube de selle (m)
    "potence": 0.10,             # longueur de la potence (m)
    "angle_potence": -6.0,       # angle de la potence par rapport à la perpendiculaire au pivot (°)
    "entretoises": 0.02,         # bagues sous la potence (m)
    "largeur_cintre": 0.42,      # largeur du cintre, d'axe en axe (m)
    "reach_cintre": 0.08,        # avancée du cintre (m)
    "drop_cintre": 0.125,        # profondeur du cintre (m)
    "manivelle": 0.1725,         # longueur des manivelles (m)
    "plateaux": [52, 36],        # dents des plateaux, du plus grand au plus petit
    "cassette": [11, 12, 13, 14, 15, 17, 19, 21, 24, 27, 30],
    "pignon_chaine": 17,         # pignon sur lequel la chaîne est posée (sur le grand plateau)
    "bidons": 1,                 # 0, 1 (tube oblique) ou 2 (+ tube de selle)
    "lods": [0, 1, 2],
    "formats": ["glb", "fbx"],   # glb, fbx, blend
    "sortie": "sortie",
    "apercu": False,             # rendus PNG (Cycles) pour vérifier le résultat
}

# Qualité de chaque niveau de détail.
QUALITE = {
    0: {"tube": 16, "petit": 10, "fil": 4, "roue": 72, "moyeu": 32, "pneu": 12, "jante": 12, "dents": 4, "dents_cassette": 2,
        "cassette": "pignons", "courbe": 6, "arc": 20, "pas": 0.008, "selle": 16, "rayons": True, "chaine": True, "bidon": True,
        "details": True, "moyeu_detaille": True},
    1: {"tube": 8, "petit": 6, "fil": 3, "roue": 36, "moyeu": 12, "pneu": 6, "jante": 7, "dents": 0, "dents_cassette": 0,
        "cassette": "marches", "courbe": 3, "arc": 10, "pas": 0.03, "selle": 10, "rayons": True, "chaine": True, "bidon": True,
        "details": True, "moyeu_detaille": False},
    2: {"tube": 6, "petit": 4, "fil": 0, "roue": 20, "moyeu": 6, "pneu": 5, "jante": 4, "dents": 0, "dents_cassette": 0,
        "cassette": "cone", "courbe": 1, "arc": 6, "pas": 0.05, "selle": 6, "rayons": False, "chaine": False, "bidon": False,
        "details": False, "moyeu_detaille": False},
}

# ---------------------------------------------------------------------------------------------------
# Palette : 16 nuances sur une texture de 64 × 64 (cases de 16 px). Chaque face pointe le centre de sa case.

NUANCES = ["peinture", "accent", "carbone", "noir_mat", "alu", "acier", "metal_sombre", "chaine",
           "gomme", "flanc", "guidoline", "selle", "bidon", "cocotte", "blanc", "catadioptre"]
MATIERES = {  # couleur linéaire, métal, rugosité (la peinture et l'accent prennent les couleurs choisies)
    "peinture": (None, 0.0, 0.28), "accent": (None, 0.0, 0.30),
    "carbone": ((0.025, 0.025, 0.028), 0.0, 0.30), "noir_mat": ((0.03, 0.03, 0.032), 0.0, 0.60),
    "alu": ((0.75, 0.76, 0.78), 1.0, 0.32), "acier": ((0.60, 0.60, 0.62), 1.0, 0.22),
    "metal_sombre": ((0.12, 0.12, 0.13), 1.0, 0.35), "chaine": ((0.35, 0.35, 0.36), 1.0, 0.45),
    "gomme": ((0.035, 0.035, 0.035), 0.0, 0.82), "flanc": ((0.45, 0.30, 0.16), 0.0, 0.80),
    "guidoline": ((0.04, 0.04, 0.045), 0.0, 0.75), "selle": ((0.03, 0.03, 0.03), 0.0, 0.55),
    "bidon": ((0.85, 0.85, 0.82), 0.0, 0.35), "cocotte": ((0.02, 0.02, 0.022), 0.0, 0.70),
    "blanc": ((0.85, 0.85, 0.85), 0.0, 0.35), "catadioptre": ((0.6, 0.05, 0.03), 0.0, 0.30),
}
N = {nom: i for i, nom in enumerate(NUANCES)}
CASES = 4      # cases par côté
CASE_PX = 16   # pixels par case


def uv_nuance(i):
    return ((i % CASES + 0.5) / CASES, (i // CASES + 0.5) / CASES)


def lin_vers_srgb(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_srgb(h):
    h = h.strip().lstrip("#")
    if len(h) != 6:
        raise SystemExit(f"couleur invalide : #{h} (attendu : #RRVVBB)")
    try:
        return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        raise SystemExit(f"couleur invalide : #{h} (attendu : #RRVVBB)") from None


def creer_palette(nom, couleur, accent, dossier):
    """Trois images : couleur (sRGB), métal/rugosité au format glTF (G = rugosité, B = métal) et au
    format URP (R = métal, A = lissé), pour régler un matériau URP/Lit à la main après un import FBX."""
    taille = CASES * CASE_PX
    couleur_srgb, accent_srgb = hex_srgb(couleur), hex_srgb(accent)
    px_c, px_mr, px_u = ([0.0] * (taille * taille * 4) for _ in range(3))
    for i, nuance in enumerate(NUANCES):
        lin, metal, rug = MATIERES[nuance]
        if nuance == "peinture":
            srgb = couleur_srgb
        elif nuance == "accent":
            srgb = accent_srgb
        else:
            srgb = tuple(lin_vers_srgb(c) for c in lin)
        cx, cy = i % CASES, i // CASES
        for y in range(cy * CASE_PX, (cy + 1) * CASE_PX):
            for x in range(cx * CASE_PX, (cx + 1) * CASE_PX):
                k = (y * taille + x) * 4
                px_c[k:k + 4] = [srgb[0], srgb[1], srgb[2], 1.0]
                px_mr[k:k + 4] = [0.0, rug, metal, 1.0]
                px_u[k:k + 4] = [metal, metal, metal, 1.0 - rug]
    images = {}
    for suffixe, px, couleurs, alpha in (("Palette", px_c, "sRGB", False), ("MetalRugosite", px_mr, "Non-Color", False),
                                         ("MetalLisse", px_u, "Non-Color", True)):
        img = bpy.data.images.new(f"{nom}_{suffixe}", taille, taille, alpha=alpha)
        img.colorspace_settings.name = couleurs
        img.pixels = px
        img.filepath_raw = os.path.join(dossier, f"{nom}_{suffixe}.png")
        img.file_format = "PNG"
        img.save()
        images[suffixe] = img
    return images


def creer_materiau(nom, images):
    mat = bpy.data.materials.new(f"M_{nom}")
    mat.use_backface_culling = True   # glTF : doubleSided = false (une seule face dessinée, moitié moins de pixels)
    if mat.node_tree is None:
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None) or nt.nodes.new("ShaderNodeBsdfPrincipled")
    sortie = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None) or nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs["BSDF"], sortie.inputs["Surface"])
    t_couleur = nt.nodes.new("ShaderNodeTexImage")
    t_couleur.image, t_couleur.interpolation, t_couleur.location = images["Palette"], "Closest", (-500, 250)
    t_mr = nt.nodes.new("ShaderNodeTexImage")
    t_mr.image, t_mr.interpolation, t_mr.location = images["MetalRugosite"], "Closest", (-500, -100)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    sep.location = (-220, -100)
    nt.links.new(t_couleur.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(t_mr.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    return mat


# ---------------------------------------------------------------------------------------------------
# Outils de géométrie

def catmull_rom(pts, n):
    """Courbe lisse qui passe par les points, n sous-segments par intervalle."""
    if len(pts) < 3 or n <= 1:
        return [p.copy() for p in pts]
    P = [pts[0] + (pts[0] - pts[1])] + list(pts) + [pts[-1] + (pts[-1] - pts[-2])]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3))
    out.append(pts[-1].copy())
    return out


def arc(centre, r, a0, a1, n, e1=AV, e2=HAUT):
    """Points d'un arc dans le plan (e1, e2), de l'angle a0 à a1 (degrés), n intervalles, bornes comprises."""
    return [centre + (e1 * math.cos(math.radians(a0 + (a1 - a0) * k / n)) + e2 * math.sin(math.radians(a0 + (a1 - a0) * k / n))) * r
            for k in range(n + 1)]


def segment(a, b, pas):
    n = max(1, math.ceil((b - a).length / pas))
    return [a.lerp(b, k / n) for k in range(n + 1)]


def perpendiculaire(t):
    ref = HAUT if abs(t.z) < 0.9 else AV
    return (ref - t * ref.dot(t)).normalized()


def r_pas(dents):
    """Rayon primitif d'un plateau ou d'un pignon."""
    return PAS_CHAINE / (2 * math.sin(math.pi / dents))


def contour_dente(dents, rayon, pts_dent, segs):
    """Contour d'un plateau : (rayon, angle) ; sans dents si pts_dent vaut 0."""
    if pts_dent <= 0:
        return [(rayon, 2 * math.pi * k / segs) for k in range(segs)]
    forme = {2: [(0.0, -1), (0.5, 1)], 4: [(0.06, -1), (0.36, 1), (0.64, 1), (0.94, -1)]}[pts_dent]
    a = 2 * math.pi / dents
    return [(rayon + (0.0035 if s > 0 else -0.0042), a * (k + f)) for k in range(dents) for f, s in forme]


def _val(x, s, i):
    if callable(x):
        return x(s)
    if isinstance(x, (list, tuple)):
        return x[i]
    return x


class Maillage:
    """Accumule les sommets (repère cycliste), les faces et la nuance de chaque face."""

    def __init__(self):
        self.v, self.f, self.fs = [], [], []
        self.retournees = 0

    def _ajoute(self, verts, faces, nuances):
        # orientation : les normales doivent sortir de la pièce (Unity n'affiche pas les faces arrière).
        c = sum(verts, Vector((0.0, 0.0, 0.0))) / len(verts)
        vol = 0.0
        for f in faces:
            a = verts[f[0]] - c
            for k in range(1, len(f) - 1):
                vol += a.dot((verts[f[k]] - c).cross(verts[f[k + 1]] - c))
        if vol < 0:
            faces = [tuple(reversed(f)) for f in faces]
            self.retournees += 1
        base = len(self.v)
        self.v.extend(verts)
        self.f.extend(tuple(i + base for i in f) for f in faces)
        self.fs.extend(nuances)

    @property
    def triangles(self):
        return sum(len(f) - 2 for f in self.f)

    def tube(self, pts, rayon, cotes, nuance, aspect=1.0, ref=LAT, transport=False, bouchons=True, boucle=False, phase=0.0):
        """Tube le long d'un chemin. Section : ellipse de rayon `rayon` selon `ref` (projeté) et
        `rayon × aspect` dans l'autre direction. rayon et aspect : nombre, liste ou fonction de s ∈ [0, 1].
        transport : le repère suit le chemin (cintre) au lieu de rester accroché à `ref`."""
        if cotes < 3 or len(pts) < 2:
            return
        n = len(pts)
        long = [0.0]
        for i in range(1, n):
            long.append(long[-1] + (pts[i] - pts[i - 1]).length)
        tot = long[-1] or 1.0
        nseg = n if boucle else n - 1
        nuances = nuance if isinstance(nuance, (list, tuple)) else [nuance] * nseg
        verts, faces, fs = [], [], []
        u_prec = None
        for i in range(n):
            if boucle or 0 < i < n - 1:
                t = (pts[i] - pts[i - 1]).normalized() + (pts[(i + 1) % n] - pts[i]).normalized()
            elif i == 0:
                t = pts[1] - pts[0]
            else:
                t = pts[-1] - pts[-2]
            t.normalize()
            base = u_prec if (transport and u_prec is not None) else ref
            u = base - t * base.dot(t)
            u = u.normalized() if u.length > 1e-8 else perpendiculaire(t)
            u_prec = u
            v = t.cross(u)
            s = long[i] / tot
            r, a = _val(rayon, s, i), _val(aspect, s, i)
            for k in range(cotes):
                th = phase + 2 * math.pi * k / cotes
                verts.append(pts[i] + u * (r * math.cos(th)) + v * (r * a * math.sin(th)))
        for i in range(nseg):
            j = (i + 1) % n
            for k in range(cotes):
                k2 = (k + 1) % cotes
                faces.append((i * cotes + k, i * cotes + k2, j * cotes + k2, j * cotes + k))
                fs.append(nuances[i])
        if bouchons and not boucle:
            for i, sens in ((0, -1), (n - 1, 1)):
                c = len(verts)
                verts.append(pts[i].copy())
                b0 = len(verts)
                verts.extend(verts[i * cotes + k].copy() for k in range(cotes))
                for k in range(cotes):
                    k2 = (k + 1) % cotes
                    faces.append((c, b0 + k, b0 + k2) if sens > 0 else (c, b0 + k2, b0 + k))
                    fs.append(nuances[0] if i == 0 else nuances[-1])
        self._ajoute(verts, faces, fs)

    def tour(self, profil, segs, nuance, centre, axe=LAT, e1=AV, dur=False):
        """Révolution d'un profil fermé [(rayon, décalage le long de l'axe)] autour de `axe`.
        dur : arêtes vives entre les segments du profil (moyeu, disque) ; sinon lissé (pneu, jante)."""
        e2 = axe.cross(e1)
        n = len(profil)
        nuances = nuance if isinstance(nuance, (list, tuple)) else [nuance] * n
        verts, faces, fs = [], [], []

        def anneau(rad, dec):
            b = len(verts)
            for i in range(segs):
                ph = 2 * math.pi * i / segs
                verts.append(centre + axe * dec + (e1 * math.cos(ph) + e2 * math.sin(ph)) * rad)
            return b

        bases = None if dur else [anneau(*pt) for pt in profil]
        for j in range(n):
            if dur:
                ia, ib = anneau(*profil[j]), anneau(*profil[(j + 1) % n])
            else:
                ia, ib = bases[j], bases[(j + 1) % n]
            for i in range(segs):
                i2 = (i + 1) % segs
                faces.append((ia + i, ia + i2, ib + i2, ib + i))
                fs.append(nuances[j])
        self._ajoute(verts, faces, fs)

    def couronne(self, centre, contour, r_int, ep, nuance, axe=LAT, e1=AV):
        """Plateau, pignon ou galet : contour [(rayon, angle)] extrudé sur l'épaisseur ep, percé au rayon r_int."""
        e2 = axe.cross(e1)
        h, n = ep / 2, len(contour)

        def P(rad, ph, dec):
            return centre + axe * dec + (e1 * math.cos(ph) + e2 * math.sin(ph)) * rad

        verts, faces = [], []
        for dec, sens in ((h, 1), (-h, -1)):
            bo = len(verts)
            verts += [P(r, ph, dec) for r, ph in contour]
            bi = len(verts)
            verts += [P(r_int, ph, dec) for _, ph in contour]
            for k in range(n):
                k2 = (k + 1) % n
                f = (bo + k, bo + k2, bi + k2, bi + k)
                faces.append(f if sens > 0 else f[::-1])
        for k in range(n):  # bord extérieur, facettes à plat (dents nettes)
            (r1, p1), (r2, p2) = contour[k], contour[(k + 1) % n]
            b = len(verts)
            verts += [P(r1, p1, h), P(r1, p1, -h), P(r2, p2, -h), P(r2, p2, h)]
            faces.append((b, b + 1, b + 2, b + 3))
        bf = len(verts)
        verts += [P(r_int, ph, h) for _, ph in contour]
        bd = len(verts)
        verts += [P(r_int, ph, -h) for _, ph in contour]
        for k in range(n):
            k2 = (k + 1) % n
            faces.append((bf + k2, bd + k2, bd + k, bf + k))
        self._ajoute(verts, faces, [nuance] * len(faces))

    def boite(self, centre, demi, nuance, base=(LAT, AV, HAUT)):
        """Pavé à faces planes : demi-tailles selon les trois axes de `base`."""
        R, F, U = base
        coins = [centre + R * (sx * demi[0]) + F * (sy * demi[1]) + U * (sz * demi[2])
                 for sx, sy, sz in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
        verts, faces = [], []
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (0, 4, 7, 3), (1, 2, 6, 5)):
            b = len(verts)
            verts += [coins[i].copy() for i in f]
            faces.append((b, b + 1, b + 2, b + 3))
        self._ajoute(verts, faces, [nuance] * 6)


# ---------------------------------------------------------------------------------------------------
# Géométrie du vélo

def calculer_geometrie(p):
    if p["cadre"] not in CADRES:
        raise SystemExit(f"cadre inconnu : {p['cadre']} (choix : {', '.join(CADRES)})")
    if p["roues"] not in ROUES:
        raise SystemExit(f"roues inconnues : {p['roues']} (choix : {', '.join(ROUES)})")
    if p["pneus"] not in PNEUS:
        raise SystemExit(f"pneus inconnus : {p['pneus']} (choix : {', '.join(PNEUS)})")
    g = dict(GEO_BASE)
    g.update(CADRES[p["cadre"]])
    inconnues = set(p["geometrie"]) - set(GEO_BASE)
    if inconnues:
        raise SystemExit(f"cotes inconnues dans « geometrie » : {', '.join(sorted(inconnues))}")
    dt = p["taille_cm"] - 56
    g["stack"] += 0.0095 * dt
    g["reach"] += 0.0035 * dt
    g["douille"] += 0.010 * dt
    g["tube_selle"] += 0.010 * dt
    g.update(p["geometrie"])

    pneu = PNEUS[p["pneus"]]
    tr = pneu["largeur"] / 2000.0
    R = R_JANTE + 2 * tr
    hta, sta = math.radians(g["angle_direction"]), math.radians(g["angle_selle"])
    d = Vector((0.0, math.cos(hta), -math.sin(hta)))   # descend l'axe de direction
    n = Vector((0.0, math.sin(hta), math.cos(hta)))    # perpendiculaire au pivot, vers l'avant
    s = Vector((0.0, -math.cos(sta), math.sin(sta)))   # monte le long du tube de selle
    drop, bases = g["drop_boitier"], g["bases"]
    bb = Vector((0.0, 0.0, R - drop))
    ar = Vector((0.0, -math.sqrt(bases * bases - drop * drop), R))
    hh = bb + Vector((0.0, g["reach"], g["stack"]))
    hb = hh + d * g["douille"]
    t = (R - hb.z - n.z * g["deport"]) / d.z     # l'axe avant est à la hauteur R, décalé du déport
    av = hb + d * t + n * g["deport"]
    decal = AV * (-(ar.y + av.y) / 2)            # origine au milieu de l'empattement
    for v in (bb, ar, hh, hb, av):
        v += decal

    # poste de pilotage
    sc = hh - d * (0.008 + p["entretoises"] + 0.02)   # centre du serrage de la potence
    a = math.radians(p["angle_potence"])
    dir_potence = n * math.cos(a) - d * math.sin(a)
    cintre = sc + dir_potence * p["potence"]

    rs = ROUES[p["roues"]]
    roue_av = ROUES[rs["avant"]] if "avant" in rs else rs
    roue_ar = {"lenticulaire": True} if rs.get("arriere") == "lenticulaire" else rs

    g.update({"R": R, "tr": tr, "flanc": pneu.get("flanc", False), "d": d, "n": n, "s": s, "bb": bb, "ar": ar, "av": av,
              "hh": hh, "hb": hb, "fourche": t - 0.015, "sc": sc, "cintre": cintre, "roue_av": roue_av, "roue_ar": roue_ar,
              "selle": bb + s * p["hauteur_selle"], "empattement": av.y - ar.y})
    return g


def chemin_cintre(p, g, q):
    """Cintre complet (bas gauche → bas droit) autour du point de serrage : points, rayons, aspects,
    nuances, et repères pour les cocottes et les mains (côté droit, repère cycliste)."""
    C, ev = g["cintre"], g["evasement"]
    w2, rc, pas = p["largeur_cintre"] / 2, 0.035, q["pas"]
    a, b = p["reach_cintre"] - rc, p["drop_cintre"] / 2
    aero = g["cintre"] == "aero"

    def courbe(phi):  # bas du cintre, côté droit ; phi = 90° en haut, -90° en bas
        ph = math.radians(phi)
        return C + Vector((w2 + ev * (0.5 - 0.5 * math.sin(ph)), rc + a * math.cos(ph), -b + b * math.sin(ph)))

    droite = [C + Vector((x, 0.0, 0.0)) for x in [k * (w2 - rc) / max(1, math.ceil((w2 - rc) / pas)) for k in range(math.ceil((w2 - rc) / pas) + 1)]]
    n_coin = max(2, math.ceil(rc * math.pi / 2 / pas))
    droite += [C + Vector((w2 - rc + rc * math.cos(math.radians(-90 + 90 * k / n_coin)), rc + rc * math.sin(math.radians(-90 + 90 * k / n_coin)), 0.0))
               for k in range(1, n_coin + 1)]
    n_bas = max(4, math.ceil(math.pi * (a + b) / 2 / pas))
    droite += [courbe(90 - 180 * k / n_bas) for k in range(1, n_bas + 1)]
    fin = courbe(-90)
    droite += [fin + Vector((ev * 0.15 * k / 3, -0.10 * k / 3, -0.006 * k / 3)) for k in range(1, 4)]

    def rayon(x):
        x = abs(x)
        return 0.0159 if x < 0.045 else (0.0135 if x > 0.07 else 0.0159 + (0.0135 - 0.0159) * (x - 0.045) / 0.025)

    def info(pt, sur_dessus):
        x = abs(pt.x - C.x)
        r = rayon(x)
        if aero and sur_dessus and x > 0.03:
            return r * 0.62, 2.6, N["carbone"]          # dessus plat profilé, sans guidoline
        return r, 1.0, (N["carbone"] if x < 0.07 else N["guidoline"])

    n_dessus = math.ceil((w2 - rc) / pas) + 1 + n_coin
    gauche = [Vector((2 * C.x - v.x, v.y, v.z)) for v in droite[1:]]
    pts = list(reversed(gauche)) + droite
    sur_dessus = list(reversed([k < n_dessus for k in range(1, len(droite))])) + [k < n_dessus for k in range(len(droite))]
    infos = [info(pt, sd) for pt, sd in zip(pts, sur_dessus)]
    # transition douce entre le dessus aéro et le bas du cintre
    rayons = [i[0] for i in infos]
    aspects = [i[1] for i in infos]
    for _ in range(3):
        aspects = [aspects[0]] + [(aspects[k - 1] + 2 * aspects[k] + aspects[k + 1]) / 4 for k in range(1, len(aspects) - 1)] + [aspects[-1]]
        rayons = [rayons[0]] + [(rayons[k - 1] + 2 * rayons[k] + rayons[k + 1]) / 4 for k in range(1, len(rayons) - 1)] + [rayons[-1]]
    nuances = [infos[k][2] if infos[k][2] == infos[k + 1][2] else N["guidoline"] for k in range(len(pts) - 1)]

    base_cocotte = courbe(62) + HAUT * 0.004
    bout_cocotte = C + Vector((w2 + ev * 0.05, p["reach_cintre"] + 0.055, 0.014))
    milieu_cocotte = base_cocotte.lerp(bout_cocotte, 0.5) + HAUT * 0.012
    reperes = {
        "cocotte": [base_cocotte, milieu_cocotte, bout_cocotte],
        "levier": [bout_cocotte + Vector((0.0, -0.006, -0.014)), courbe(10) + AV * 0.03, courbe(-40) + AV * 0.02],
        "main_cocotte": base_cocotte.lerp(bout_cocotte, 0.55) + HAUT * 0.018,
        "main_bas": fin + Vector((ev * 0.05, -0.04, 0.0)),
        "main_haut": C + Vector((w2 - 0.08, 0.0, 0.0)),
    }
    return pts, rayons, aspects, nuances, reperes


def construire(p, g, q):
    """Construit les pièces d'un niveau de détail. Renvoie {groupe: Maillage} et les ancres (repère cycliste)."""
    M = {k: Maillage() for k in ("Cadre", "Direction", "RoueAvant", "RoueArriere", "Pedalier", "PedaleD", "PedaleG")}
    T, P_, k = q["tube"], q["petit"], g["k"]
    kl = min(k, 1.0)

    def asp(w):
        return 1.0 + (g["profil"] - 1.0) * w

    bb, ar, av, hh, hb, d, n, s = (g[x] for x in ("bb", "ar", "av", "hh", "hb", "d", "n", "s"))
    pc, nc, cb, ms = N["peinture"], N["noir_mat"], N["carbone"], N["metal_sombre"]
    cadre = M["Cadre"]

    # --- cadre
    L_st = g["tube_selle"]
    cadre.tube([hb + d * 0.008, hh - d * 0.004], [0.0235 * k ** 0.5, 0.0195 * k ** 0.5], T, pc, aspect=asp(0.5))      # douille
    cadre.tube([bb + s * (L_st - 0.018), hh + d * 0.028], [0.0150 * k, 0.0140 * k], T, pc, aspect=asp(0.3))            # tube horizontal
    fin_oblique = hb - d * 0.035                                                                                        # tube oblique,
    cadre.tube([bb, bb.lerp(fin_oblique, 0.72), bb.lerp(fin_oblique, 0.86), fin_oblique],                              # bande d'accent
               lambda t: (0.0215 - 0.002 * t) * k, T, [pc, N["accent"], pc], aspect=asp(1.0))
    cadre.tube([bb, bb + s * L_st], 0.0158 * k, T, pc, aspect=asp(0.85))                                                # tube de selle
    cadre.tube([bb - LAT * 0.043, bb + LAT * 0.043], 0.0215, T, pc, ref=AV)                                             # boîtier
    jonction = bb + s * (L_st * g["haubans"])
    c_dir = (ar - bb).normalized()
    L_cs = (ar - bb).length
    for cote in (1, -1):
        bases = catmull_rom([bb + c_dir * 0.02 + LAT * (cote * 0.028), bb + c_dir * 0.10 + LAT * (cote * 0.031),
                             bb + c_dir * (L_cs - 0.10) + LAT * (cote * 0.057), ar + LAT * (cote * 0.0655)], q["courbe"])
        cadre.tube(bases, lambda t: (0.0078 - 0.0018 * t) * kl, T, pc, aspect=lambda t: (1.8 - 0.5 * t) * asp(0.2))
        h_dir = (jonction - ar).normalized()
        haubans = catmull_rom([ar + LAT * (cote * 0.061) + h_dir * 0.015, ar.lerp(jonction, 0.45) + LAT * (cote * 0.044),
                               jonction + LAT * (cote * 0.013)], q["courbe"])
        cadre.tube(haubans, lambda t: (0.0062 + 0.0022 * t) * k, T, pc, aspect=asp(0.5))
        cadre.boite(ar + LAT * (cote * 0.064) + AV * 0.006 + HAUT * 0.004, (0.0035, 0.02, 0.016), pc)                   # patte arrière
    cadre.boite(ar + LAT * 0.0675 + AV * (-0.006) + HAUT * (-0.022), (0.002, 0.008, 0.016), ms)                          # patte de dérailleur
    if q["details"]:
        cadre.tube([ar - LAT * 0.075, ar + LAT * 0.071], 0.0075, P_, ms, ref=AV)                                         # axe traversant

    # --- tige de selle et selle
    sel = g["selle"]
    serrage = bb + s * (p["hauteur_selle"] - 0.05)
    cadre.tube([bb + s * (L_st - 0.06), serrage], 0.0136, T, cb, aspect=asp(0.9))
    cadre.tube([serrage - LAT * 0.022, serrage + LAT * 0.022], 0.011, P_, ms, ref=AV)
    ns = q["selle"]
    xs = [i / (ns - 1) for i in range(ns)]

    def interp(x, table):
        for (x0, y0), (x1, y1) in zip(table, table[1:]):
            if x <= x1:
                return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
        return table[-1][1]

    largeur = [(0.0, 0.066), (0.12, 0.072), (0.35, 0.060), (0.55, 0.032), (0.75, 0.021), (1.0, 0.012)]
    epaisseur = [(0.0, 0.016), (0.5, 0.014), (1.0, 0.010)]
    bosse = [(0.0, 0.006), (0.25, 0.001), (0.5, 0.0), (0.85, 0.0), (1.0, 0.002)]
    centres = [Vector((0.0, sel.y - 0.115 + 0.27 * x, sel.z + interp(x, bosse) - interp(x, epaisseur))) for x in xs]
    cadre.tube(centres, [interp(x, largeur) for x in xs], T, N["selle"],
               aspect=[interp(x, epaisseur) / interp(x, largeur) for x in xs])
    if q["details"]:
        for cote in (1, -1):
            rail = catmull_rom([sel + Vector((cote * 0.030, -0.10, -0.016)), sel + Vector((cote * 0.021, -0.07, -0.038)),
                                sel + Vector((cote * 0.021, 0.06, -0.040)), sel + Vector((cote * 0.012, 0.11, -0.012))], q["courbe"])
            cadre.tube(rail, 0.0035, P_, ms, bouchons=False)

    # --- bidons
    if q["bidon"] and p["bidons"] > 0:
        profil_bidon = [(0.003, -0.102), (0.034, -0.100), (0.037, -0.090), (0.037, 0.030), (0.034, 0.050), (0.036, 0.065),
                        (0.036, 0.075), (0.020, 0.090), (0.012, 0.095), (0.012, 0.105), (0.003, 0.106)]
        nu_bidon = [N["carbone"] if dec > 0.085 else N["bidon"] for _, dec in profil_bidon]
        dt_dir = ((hb - d * 0.035) - bb).normalized()
        poses = [(dt_dir, LAT.cross(dt_dir), 0.30, 0.0215 * k * asp(1.0))]
        if p["bidons"] > 1:
            poses.append((s, s.cross(LAT), 0.26, 0.0158 * k * asp(0.85)))
        for axe, normale, pos, r_tube in poses:
            centre = bb + axe * pos + normale * (r_tube + 0.041)
            cadre.tour(profil_bidon, q["moyeu"], nu_bidon, centre, axe=axe, e1=LAT)
            if q["details"]:
                for cote in (1, -1):
                    cadre.tube([centre - axe * 0.085 - normale * 0.036 + LAT * (cote * 0.02),
                                centre + axe * 0.06 - normale * 0.036 + LAT * (cote * 0.02)], 0.0025, 4, cb)

    # --- transmission : positions
    plateaux = sorted(p["plateaux"], reverse=True)
    lat_plateaux = [0.0455 - 0.005 * i for i in range(len(plateaux))] if len(plateaux) > 1 else [0.043]
    pignons = sorted(p["cassette"], reverse=True)
    ecart = min(0.0039, (0.058 - 0.0185) / max(1, len(pignons) - 1))
    lat_pignons = [0.0185 + i * ecart for i in range(len(pignons))]
    i_chaine = min(range(len(pignons)), key=lambda i: abs(pignons[i] - p["pignon_chaine"]))
    Rr, Rc = r_pas(plateaux[0]), r_pas(pignons[i_chaine])
    lat_r, lat_c = lat_plateaux[0], lat_pignons[i_chaine]
    rj = r_pas(11)
    J1 = ar + AV * 0.006 + HAUT * (-(r_pas(pignons[0]) + 0.0035 + 0.007 + rj))
    J2 = J1 + AV * 0.022 + HAUT * (-0.072)

    def lat_chaine(y):
        t = min(1.0, max(0.0, (y - ar.y) / (bb.y - ar.y)))
        return lat_c + (lat_r - lat_c) * t

    if q["chaine"]:
        na = q["arc"]
        boucle = arc(bb, Rr, -90, 90, na)[:-1]
        boucle += segment(bb + HAUT * Rr, ar + HAUT * Rc, 0.05)[:-1]
        boucle += arc(ar, Rc, 90, 270, max(4, na // 2))[:-1]
        boucle += segment(ar - HAUT * Rc, J1 + HAUT * rj, 0.05)[:-1]
        boucle += arc(J1, rj, 90, -90, max(4, na // 3))[:-1]
        boucle += segment(J1 - HAUT * rj, J2 + HAUT * rj, 0.05)[:-1]
        boucle += arc(J2, rj, 90, 270, max(4, na // 3))[:-1]
        boucle += segment(J2 - HAUT * rj, bb - HAUT * Rr, 0.05)[:-1]
        boucle = [pt + LAT * lat_chaine(pt.y) for pt in boucle]
        cadre.tube(boucle, 0.0078, 4, N["chaine"], aspect=0.73, boucle=True, phase=math.pi / 4)
    if q["details"]:
        for J in (J1, J2):  # galets
            cadre.couronne(J + LAT * lat_c, contour_dente(11, rj, min(2, q["dents"]), q["moyeu"]), 0.006, 0.004, nc)
        dj = (J2 - J1).normalized()
        for cote, dec in ((1, 0.008), (-1, -0.008)):  # chape
            cadre.tube([J1 - dj * 0.012 + LAT * (lat_c + dec), J2 + dj * 0.012 + LAT * (lat_c + dec)], 0.002, P_, cb if cote > 0 else ms,
                       aspect=12.0 if cote > 0 else 10.0)
        cadre.tube([ar + LAT * 0.069 + AV * (-0.012) + HAUT * (-0.03), J1 + LAT * (lat_c + 0.016) + HAUT * 0.012], 0.012, P_, ms, aspect=1.3)
        # dérailleur avant
        t_fd = s.cross(LAT).normalized()
        cadre.boite(bb + s * (Rr + 0.022) + LAT * 0.049, (0.0035, 0.032, 0.011), cb, base=(LAT, t_fd, s))
        cadre.boite(bb + s * (Rr + 0.03) + LAT * 0.032, (0.016, 0.008, 0.008), ms, base=(LAT, t_fd, s))
    else:
        cadre.boite(J1.lerp(J2, 0.5) + LAT * lat_c, (0.012, 0.012, 0.05), nc)

    # --- étrier arrière (disque à gauche)
    def etrier(groupe, centre, r_disque, lat, phi):
        ph = math.radians(phi)
        radial = AV * math.cos(ph) + HAUT * math.sin(ph)
        tangente = AV * (-math.sin(ph)) + HAUT * math.cos(ph)
        groupe.boite(centre + LAT * lat + radial * (r_disque - 0.012), (0.012, 0.013, 0.026), nc, base=(LAT, radial, tangente))

    etrier(cadre, ar, 0.070, -0.056, 18)

    # --- direction : fourche, pivot, potence, cintre, cocottes
    dr = M["Direction"]
    couronne_f = hb + d * 0.016
    r_douille = 0.0235 * k ** 0.5 * asp(0.5)   # profondeur du bas de la douille : la couronne l'affleure
    dr.tube([couronne_f - LAT * 0.048, couronne_f + LAT * 0.048], r_douille, T, pc, aspect=0.024 / r_douille, ref=AV)
    for cote in (1, -1):
        dr.tube([couronne_f + d * 0.012 + LAT * (cote * 0.040), av + LAT * (cote * 0.0505)], [0.0145 * k, 0.0095 * k], T, pc,
                aspect=[r_douille / (0.0145 * k), 1.25 * asp(0.5)])
        dr.boite(av + LAT * (cote * 0.0525) + HAUT * 0.004, (0.0035, 0.014, 0.016), pc)
    if q["details"]:
        dr.tube([av - LAT * 0.058, av + LAT * 0.056], 0.0075, P_, ms, ref=AV)
    dr.tube([hh, hh - d * 0.008], 0.0215, T, ms)                                                     # jeu de direction
    if p["entretoises"] > 0.001:
        dr.tube([hh - d * 0.008, hh - d * (0.008 + p["entretoises"])], 0.0175, T, cb)             # bagues
    sc, C = g["sc"], g["cintre"]
    dr.tube([sc + d * 0.02, sc - d * 0.02], 0.0195, T, cb)                                           # serrage du pivot
    dr.tube([sc - d * 0.02, sc - d * 0.026], 0.016, T, ms)                                           # capot
    dr.tube([sc, C], [0.0165, 0.015], T, cb, aspect=1.25)                                            # potence
    dr.tube([C - LAT * 0.027, C + LAT * 0.027], 0.0195, T, cb, ref=AV)                               # serrage du cintre
    pts, rayons, aspects, nuances, rep = chemin_cintre(p, g, q)
    dr.tube(pts, rayons, T if q["details"] else P_, nuances, aspect=aspects, ref=HAUT, transport=True)

    def miroir(v):
        return Vector((2 * C.x - v.x, v.y, v.z))

    for cote in (1, -1):
        m_ = (lambda v: v) if cote > 0 else miroir
        cocotte = [m_(v) for v in rep["cocotte"]]
        dr.tube(catmull_rom(cocotte, q["courbe"]), [0.013, 0.0165, 0.012] if q["courbe"] == 1 else (lambda t: 0.013 + 0.0035 * math.sin(math.pi * t) - 0.001 * t),
                P_ if not q["details"] else T, N["cocotte"], aspect=1.3)
        if q["details"]:
            dr.tube(catmull_rom([m_(v) for v in rep["levier"]], q["courbe"]), lambda t: 0.0065 - 0.0015 * t, P_, cb, aspect=1.6)
    etrier(dr, av, 0.080, -0.048, 200)

    # --- roues
    def roue(groupe, centre, spec, arriere):
        tr = g["tr"]
        nr = q["roue"]
        # pneu
        n_p = q["pneu"]
        profil = [(R_JANTE + tr + tr * math.cos(2 * math.pi * j / n_p), tr * 1.02 * math.sin(2 * math.pi * j / n_p)) for j in range(n_p)]
        nu_pneu = []
        for j in range(n_p):
            ang = math.degrees(2 * math.pi * (j + 0.5) / n_p) % 360
            ang = ang if ang <= 180 else 360 - ang
            nu_pneu.append(N["flanc"] if g["flanc"] and 55 < ang < 140 else N["gomme"])
        groupe.tour(profil, nr, nu_pneu, centre)
        if spec.get("lenticulaire"):
            lentille = [(0.02, -0.03), (0.12, -0.024), (0.24, -0.016), (R_JANTE + 0.004, -0.011), (R_JANTE + 0.004, 0.011),
                        (0.24, 0.016), (0.12, 0.024), (0.02, 0.03)]
            groupe.tour(lentille, nr, cb, centre)
        else:
            prof = spec["profil"]
            w2 = 0.0150 if spec.get("large") else 0.0135
            if q["jante"] >= 12:
                jante = [(R_JANTE + 0.006, w2 - 0.002), (R_JANTE + 0.002, w2), (R_JANTE - prof * 0.35, w2 - 0.0005),
                         (R_JANTE - prof * 0.75, w2 * 0.75), (R_JANTE - prof, w2 * 0.3), (R_JANTE - prof - 0.0015, 0.0),
                         (R_JANTE - prof, -w2 * 0.3), (R_JANTE - prof * 0.75, -w2 * 0.75), (R_JANTE - prof * 0.35, -(w2 - 0.0005)),
                         (R_JANTE + 0.002, -w2), (R_JANTE + 0.006, -(w2 - 0.002)), (R_JANTE + 0.004, 0.0)]
            elif q["jante"] >= 7:
                jante = [(R_JANTE + 0.005, w2 - 0.001), (R_JANTE - prof * 0.4, w2), (R_JANTE - prof * 0.85, w2 * 0.55),
                         (R_JANTE - prof - 0.0015, 0.0), (R_JANTE - prof * 0.85, -w2 * 0.55), (R_JANTE - prof * 0.4, -w2),
                         (R_JANTE + 0.005, -(w2 - 0.001))]
            else:
                jante = [(R_JANTE + 0.005, w2), (R_JANTE - prof, w2 * 0.4), (R_JANTE - prof, -w2 * 0.4), (R_JANTE + 0.005, -w2)]
            groupe.tour(jante, nr, N[spec["matiere"]] if spec["matiere"] in N else cb, centre)
            # rayons
            if q["rayons"] and q["fil"] >= 3:
                fl = {1: 0.018 if arriere else 0.028, -1: 0.033 if arriere else 0.028}
                nb = spec["rayons"]
                r_jante = R_JANTE - prof + 0.004
                plats = spec["matiere"] == "carbone"
                for i in range(nb):
                    ph = 2 * math.pi * i / nb
                    cote = 1 if i % 2 == 0 else -1
                    delta = (0.5 if i % 4 < 2 else -0.5) if spec.get("croises") else 0.0
                    H = centre + LAT * (cote * fl[cote]) + (AV * math.cos(ph + delta) + HAUT * math.sin(ph + delta)) * 0.0225
                    Rm = centre + LAT * (cote * 0.003) + (AV * math.cos(ph) + HAUT * math.sin(ph)) * r_jante
                    groupe.tube([H, Rm], 0.0009 if plats else 0.0011, q["fil"], cb if plats else N["acier"],
                                aspect=2.2 if plats else 1.0, bouchons=False)
        # moyeu
        fl_d, fl_g = (0.018, 0.033) if arriere else (0.028, 0.028)
        detail = q["moyeu_detaille"]
        if detail:
            moyeu = [(0.009, -0.052), (0.011, -0.052), (0.011, -fl_g - 0.004), (0.0235, -fl_g - 0.003), (0.0245, -fl_g),
                     (0.0235, -fl_g + 0.003), (0.016, -fl_g + 0.004), (0.016, fl_d - 0.004), (0.0235, fl_d - 0.003),
                     (0.0245, fl_d), (0.0235, fl_d + 0.003), (0.011, fl_d + 0.004), (0.011, 0.052), (0.009, 0.052)]
        else:
            moyeu = [(0.009, -0.052), (0.022, -fl_g), (0.022, fl_d), (0.009, 0.052)]
        groupe.tour(moyeu, q["moyeu"], ms, centre, dur=True)
        # disque de frein (côté gauche)
        r_d, lat_d = (0.070, -0.056) if arriere else (0.080, -0.048)
        r_int = 0.046 if detail else 0.02
        if detail:
            groupe.tour([(0.012, lat_d - 0.0015), (0.047, lat_d - 0.0015), (0.047, lat_d + 0.0015), (0.012, lat_d + 0.0015)],
                        max(12, nr // 2), ms, centre, dur=True)
        groupe.tour([(r_int, lat_d - 0.0009), (r_d, lat_d - 0.0009), (r_d, lat_d + 0.0009), (r_int, lat_d + 0.0009)],
                    max(12, nr // 2), N["acier"], centre, dur=True)
        # cassette
        if arriere:
            if q["cassette"] == "pignons":
                for dents, lat in zip(pignons, lat_pignons):
                    groupe.couronne(centre + LAT * lat, contour_dente(dents, r_pas(dents), q["dents_cassette"], q["moyeu"]),
                                    min(0.017, r_pas(dents) - 0.0065), 0.0018, N["acier"])
            else:
                choix = list(zip(pignons, lat_pignons))
                if q["cassette"] == "cone":
                    choix = [choix[0], choix[-1]]
                profil = [(0.017, choix[0][1] - 0.0009)]
                for dents, lat in choix:
                    rp = r_pas(dents) + 0.002
                    profil += [(rp, lat - 0.0009), (rp, lat + 0.0009)]
                profil.append((0.017, choix[-1][1] + 0.0009))
                groupe.tour(profil, q["moyeu"], N["acier"], centre, dur=True)

    roue(M["RoueAvant"], av, g["roue_av"], False)
    roue(M["RoueArriere"], ar, g["roue_ar"], True)

    # --- pédalier (manivelle droite vers l'avant, à l'horizontale)
    pd = M["Pedalier"]
    L = p["manivelle"]
    pd.tube([bb - LAT * 0.066, bb + LAT * 0.066], 0.012, P_, ms, ref=AV)
    for dents, lat in zip(plateaux, lat_plateaux):
        rp = r_pas(dents)
        pd.couronne(bb + LAT * lat, contour_dente(dents, rp, q["dents"], q["roue"]), rp - (0.018 if dents > 40 else 0.015), 0.0018, cb)
    for i in range(4):
        ph = math.radians(45 + 90 * i)
        radial = AV * math.cos(ph) + HAUT * math.sin(ph)
        pd.tube([bb + LAT * 0.049 + radial * 0.014, bb + LAT * 0.0465 + radial * (r_pas(plateaux[0]) - 0.012)], [0.006, 0.004], P_, cb,
                aspect=2.0)
    oeil_d, oeil_g = bb + AV * L + LAT * 0.077, bb - AV * L - LAT * 0.077
    for cote, oeil in ((1, oeil_d), (-1, oeil_g)):
        depart = bb + LAT * (cote * 0.058)
        pd.tube([depart, oeil - LAT * (cote * 0.004)], [0.0125, 0.0095], T, cb, aspect=1.9)
        pd.tube([depart - LAT * (cote * 0.008), depart + LAT * (cote * 0.008)], 0.018, T, cb, ref=AV)
    for groupe, cote, oeil in (("PedaleD", 1, oeil_d), ("PedaleG", -1, oeil_g)):
        pe = M[groupe]
        pe.tube([oeil - LAT * (cote * 0.004), oeil + LAT * (cote * 0.052)], 0.0055, P_, ms, ref=AV)
        pe.tube([oeil + LAT * (cote * 0.033) + AV * (-0.042), oeil + LAT * (cote * 0.033) + AV * 0.046],
                lambda t: 0.031 - 0.009 * t, T if q["details"] else P_, cb, aspect=lambda t: 0.009 / (0.031 - 0.009 * t))

    ancres = {
        "Repere_AxeDirection": ("Pivot_Direction", hh),   # point de l'axe de direction : donne l'axe de braquage
        "Ancre_Selle": ("racine", sel + AV * (-0.03)),
        "Ancre_MainD_Cocotte": ("Pivot_Direction", rep["main_cocotte"]),
        "Ancre_MainG_Cocotte": ("Pivot_Direction", miroir(rep["main_cocotte"])),
        "Ancre_MainD_Bas": ("Pivot_Direction", rep["main_bas"]),
        "Ancre_MainG_Bas": ("Pivot_Direction", miroir(rep["main_bas"])),
        "Ancre_MainD_Haut": ("Pivot_Direction", rep["main_haut"]),
        "Ancre_MainG_Haut": ("Pivot_Direction", miroir(rep["main_haut"])),
        "Ancre_PiedD": ("Pivot_PedaleD", oeil_d + LAT * 0.033 + HAUT * 0.011),
        "Ancre_PiedG": ("Pivot_PedaleG", oeil_g - LAT * 0.033 + HAUT * 0.011),
    }
    pivots = {"oeil_d": oeil_d, "oeil_g": oeil_g}
    transmission = {"plateau": plateaux[0], "pignon": pignons[i_chaine]}
    return M, ancres, pivots, transmission


# ---------------------------------------------------------------------------------------------------
# Scène Blender

def objet_vide(nom, monde, parent, parent_monde, col, taille=0.04):
    ob = bpy.data.objects.new(nom, None)
    ob.empty_display_type = "ARROWS"
    ob.empty_display_size = taille
    col.objects.link(ob)
    ob.parent = parent
    ob.matrix_basis = parent_monde.inverted() @ monde if parent is not None else monde
    return ob


def objet_maillage(nom, mm, pivot, pivot_monde, mat, col):
    inv = pivot_monde.inverted()
    me = bpy.data.meshes.new(nom)
    me.from_pydata([(inv @ vers_blender(v))[:] for v in mm.v], [], mm.f)
    uv = me.uv_layers.new(name="UVMap")
    coords = []
    for f, nu in zip(mm.f, mm.fs):
        coords.extend(uv_nuance(nu) * len(f))
    uv.data.foreach_set("uv", coords)
    me.materials.append(mat)
    if hasattr(me, "shade_smooth"):
        me.shade_smooth()
    else:
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.update()
    ob = bpy.data.objects.new(nom, me)
    col.objects.link(ob)
    ob.parent = pivot
    return ob


def generer(p):
    nom = p["nom"] or "Velo_" + p["cadre"].capitalize()
    dossier = os.path.abspath(p["sortie"])
    os.makedirs(dossier, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    col = bpy.data.collections.new(nom)
    scene.collection.children.link(col)

    g = calculer_geometrie(p)
    mat = creer_materiau(nom, creer_palette(nom, p["couleur"], p["accent"], dossier))

    # pivots (repère Blender) : la direction tourne autour de l'axe du pivot (axe Y local dans Unity)
    I = Matrix.Identity(4)
    z = vers_blender(-g["d"]).normalized()
    x = Vector((1.0, 0.0, 0.0))
    y = z.cross(x)
    rot_dir = Matrix((x, y, z)).transposed().to_4x4()
    _, ancres, pv, transmission = construire(p, g, QUALITE[2])  # positions des ancres et des pivots
    mondes = {
        "racine": I,
        "Pivot_Direction": Matrix.Translation(vers_blender(g["hb"])) @ rot_dir,
        "Pivot_RoueAvant": Matrix.Translation(vers_blender(g["av"])),
        "Pivot_RoueArriere": Matrix.Translation(vers_blender(g["ar"])),
        "Pivot_Pedalier": Matrix.Translation(vers_blender(g["bb"])),
        "Pivot_PedaleD": Matrix.Translation(vers_blender(pv["oeil_d"])),
        "Pivot_PedaleG": Matrix.Translation(vers_blender(pv["oeil_g"])),
    }
    parents = {"Pivot_Direction": "racine", "Pivot_RoueAvant": "Pivot_Direction", "Pivot_RoueArriere": "racine",
               "Pivot_Pedalier": "racine", "Pivot_PedaleD": "Pivot_Pedalier", "Pivot_PedaleG": "Pivot_Pedalier"}
    obs = {"racine": objet_vide(nom, I, None, I, col, 0.2)}
    for piv in ("Pivot_Direction", "Pivot_RoueAvant", "Pivot_RoueArriere", "Pivot_Pedalier", "Pivot_PedaleD", "Pivot_PedaleG"):
        obs[piv] = objet_vide(piv, mondes[piv], obs[parents[piv]], mondes[parents[piv]], col)
    for an, (parent, pos) in ancres.items():
        objet_vide(an, Matrix.Translation(vers_blender(pos)), obs[parent], mondes[parent], col, 0.025)

    groupe_pivot = {"Cadre": "racine", "Direction": "Pivot_Direction", "RoueAvant": "Pivot_RoueAvant", "RoueArriere": "Pivot_RoueArriere",
                    "Pedalier": "Pivot_Pedalier", "PedaleD": "Pivot_PedaleD", "PedaleG": "Pivot_PedaleG"}
    triangles, par_lod, retournees = {}, {}, 0
    for lod in p["lods"]:
        maillages = construire(p, g, QUALITE[lod])[0]
        triangles[f"LOD{lod}"] = {}
        par_lod[lod] = []
        for groupe, mm in maillages.items():
            if not mm.f:
                continue
            piv = groupe_pivot[groupe]
            ob = objet_maillage(f"{groupe}_LOD{lod}", mm, obs[piv], mondes[piv], mat, col)
            par_lod[lod].append(ob)
            triangles[f"LOD{lod}"][ob.name] = mm.triangles
            retournees += mm.retournees
        triangles[f"LOD{lod}"]["total"] = sum(triangles[f"LOD{lod}"].values())

    bpy.context.view_layer.update()
    fichiers = []
    if "glb" in p["formats"]:
        chemin = os.path.join(dossier, nom + ".glb")
        bpy.ops.export_scene.gltf(filepath=chemin, export_format="GLB", use_selection=False, export_yup=True,
                                  export_apply=False, export_cameras=False, export_extras=False)
        fichiers.append(chemin)
    if "fbx" in p["formats"]:
        chemin = os.path.join(dossier, nom + ".fbx")
        bpy.ops.export_scene.fbx(filepath=chemin, use_selection=False, object_types={"EMPTY", "MESH"},
                                 apply_unit_scale=True, apply_scale_options="FBX_SCALE_ALL", axis_forward="-Z", axis_up="Y",
                                 bake_space_transform=False, mesh_smooth_type="OFF", use_tspace=False, add_leaf_bones=False,
                                 path_mode="COPY", embed_textures=True, bake_anim=False)
        fichiers.append(chemin)
    if "blend" in p["formats"]:
        chemin = os.path.join(dossier, nom + ".blend")
        bpy.ops.wm.save_as_mainfile(filepath=chemin, copy=True, relative_remap=True)
        fichiers.append(chemin)

    unity = {}
    for ob in col.objects:
        if ob.type == "EMPTY":
            unity[ob.name] = vers_unity(ob.matrix_world.translation)
    rapport = {
        "nom": nom,
        "parametres": {k: v for k, v in p.items() if k not in ("tous", "liste")},
        "geometrie": {
            "rayon_roue": round(g["R"], 4), "empattement": round(g["empattement"], 4), "hauteur_boitier": round(g["bb"].z, 4),
            "fourche_axe_couronne": round(g["fourche"], 4), "stack": round(g["stack"], 4), "reach": round(g["reach"], 4),
            "angle_direction": g["angle_direction"], "angle_selle": g["angle_selle"],
        },
        "transmission": {**transmission, "manivelle": p["manivelle"],
                         "developpement_m": round(2 * math.pi * g["R"] * transmission["plateau"] / transmission["pignon"], 3)},
        "triangles": triangles,
        "positions_unity": unity,
        "fichiers": [os.path.basename(f) for f in fichiers],
    }
    with open(os.path.join(dossier, nom + ".rapport.json"), "w", encoding="utf-8") as fh:
        json.dump(rapport, fh, ensure_ascii=False, indent=2)
    print(f"{nom} : " + ", ".join(f"{k} {v['total']} triangles" for k, v in triangles.items()))
    if retournees:
        print(f"  ({retournees} pièces retournées à la construction)")
    for f in fichiers:
        print("  →", f)
    if p["apercu"]:
        rendre_apercus(nom, dossier, par_lod, g)
    return rapport


# ---------------------------------------------------------------------------------------------------
# Aperçus (Cycles, processeur)

def rendre_apercus(nom, dossier, par_lod, g):
    import numpy as np

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    try:
        scene.cycles.use_denoising = True
    except AttributeError:
        pass
    monde = bpy.data.worlds.new("Monde")
    scene.world = monde
    if monde.node_tree is None:
        monde.use_nodes = True
    fond = next(n for n in monde.node_tree.nodes if n.type == "BACKGROUND")
    fond.inputs["Color"].default_value = (0.62, 0.68, 0.78, 1.0)
    fond.inputs["Strength"].default_value = 0.9
    sol_me = bpy.data.meshes.new("Sol")
    sol_me.from_pydata([(-20, -20, 0), (20, -20, 0), (20, 20, 0), (-20, 20, 0)], [], [(0, 1, 2, 3)])
    sol_mat = bpy.data.materials.new("Sol")
    if sol_mat.node_tree is None:
        sol_mat.use_nodes = True
    b = next(n for n in sol_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.42, 0.42, 0.40, 1.0)
    b.inputs["Roughness"].default_value = 0.9
    sol_me.materials.append(sol_mat)
    sol = bpy.data.objects.new("Sol", sol_me)
    scene.collection.objects.link(sol)
    soleil = bpy.data.objects.new("Soleil", bpy.data.lights.new("Soleil", "SUN"))
    soleil.data.energy = 3.2
    soleil.data.angle = math.radians(6)
    soleil.rotation_euler = (math.radians(42), 0.0, math.radians(-125))
    scene.collection.objects.link(soleil)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    scene.collection.objects.link(cam)
    scene.camera = cam

    def viser(pos, cible):
        cam.location = pos
        cam.rotation_euler = (Vector(cible) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()

    def montrer(lod):
        for l, obs in par_lod.items():
            for ob in obs:
                ob.hide_render = l != lod

    def rendre(fichier, lx, ly, format_="JPEG"):
        scene.render.resolution_x, scene.render.resolution_y = lx, ly
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = format_
        if format_ == "JPEG":
            scene.render.image_settings.quality = 88
        scene.render.filepath = os.path.join(dossier, fichier)
        bpy.ops.render.render(write_still=True)
        return scene.render.filepath

    lod0 = min(par_lod)
    montrer(lod0)
    cam.data.type = "PERSP"
    cam.data.lens = 50
    viser((-1.85, -1.55, 1.0), (0.0, -0.05, 0.52))
    rendre(f"{nom}_apercu.jpg", 1200, 760)
    cible = g["bb"].lerp(g["ar"], 0.4) + HAUT * 0.02
    cam.data.lens = 55
    viser(vers_blender(cible + LAT * 1.0 + AV * 0.3 + HAUT * 0.3), vers_blender(cible))
    rendre(f"{nom}_apercu_transmission.jpg", 1000, 640)
    # vue du cycliste (ce que voit le joueur dans le casque) : yeux au-dessus du cintre, regard vers la roue avant
    cam.data.lens = 18
    viser(vers_blender(g["selle"] + AV * 0.50 + HAUT * 0.42), vers_blender(g["cintre"] + AV * 0.55 + HAUT * (-0.55)))
    rendre(f"{nom}_apercu_cycliste.jpg", 1000, 640)
    cam.data.lens = 50
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 1.9
    viser((-4.0, 0.0, 0.55), (0.0, 0.0, 0.55))
    rendre(f"{nom}_apercu_profil.jpg", 1200, 760)
    # planche des niveaux de détail
    cam.data.type = "PERSP"
    cam.data.lens = 50
    viser((-1.85, -1.55, 1.0), (0.0, -0.05, 0.52))
    scene.cycles.samples = 24
    images = []
    for lod in sorted(par_lod):
        montrer(lod)
        chemin = rendre(f"_lod{lod}.png", 600, 380, "PNG")
        img = bpy.data.images.load(chemin)
        px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        images.append(px.reshape(img.size[1], img.size[0], 4))
        bpy.data.images.remove(img)
        os.remove(chemin)
    planche = np.concatenate(images, axis=1)
    sortie = bpy.data.images.new(f"{nom}_apercu_lod", planche.shape[1], planche.shape[0], alpha=True)
    sortie.pixels.foreach_set(planche.ravel())
    sortie.filepath_raw = os.path.join(dossier, f"{nom}_apercu_lod.jpg")
    sortie.file_format = "JPEG"
    try:
        sortie.save(quality=88)
    except TypeError:  # Blender < 4.2
        sortie.save()
    montrer(lod0)
    print("  aperçus :", ", ".join(f"{nom}_apercu{s}.jpg" for s in ("", "_transmission", "_cycliste", "_profil", "_lod")))


# ---------------------------------------------------------------------------------------------------
# Ligne de commande

def lire_parametres(argv):
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    ap = argparse.ArgumentParser(prog="velo_route.py", add_help=False,
                                 description="Vélo de route paramétrique pour Unity (glb / fbx), construit par Blender.")
    ap.add_argument("--aide", "-h", "--help", action="help", help="affiche cette aide")
    ap.add_argument("--config", help="fichier JSON de paramètres (les clés de PARAMETRES)")
    ap.add_argument("--cadre", choices=list(CADRES))
    ap.add_argument("--roues", choices=list(ROUES))
    ap.add_argument("--pneus", choices=list(PNEUS))
    ap.add_argument("--taille", type=float, dest="taille_cm", help="taille du cadre en cm (56 par défaut)")
    ap.add_argument("--couleur", help="peinture du cadre, #RRVVBB")
    ap.add_argument("--accent", help="couleur d'accent, #RRVVBB")
    ap.add_argument("--hauteur-selle", type=float, dest="hauteur_selle", help="axe du boîtier → dessus de la selle (m)")
    ap.add_argument("--bidons", type=int, choices=[0, 1, 2])
    ap.add_argument("--nom", help="nom de l'objet racine et des fichiers")
    ap.add_argument("--sortie", help="dossier de sortie")
    ap.add_argument("--formats", help="liste : glb,fbx,blend")
    ap.add_argument("--lods", help="niveaux de détail, par exemple 0,1,2")
    ap.add_argument("--apercu", action="store_true", default=None, help="rendus PNG de contrôle (Cycles)")
    ap.add_argument("--tous", action="store_true", help="un vélo par cadre du catalogue")
    ap.add_argument("--liste", action="store_true", help="affiche le catalogue et quitte")
    a = ap.parse_args(argv)
    p = json.loads(json.dumps(PARAMETRES))
    if a.config:
        with open(a.config, encoding="utf-8") as fh:
            conf = json.load(fh)
        inconnues = set(conf) - set(PARAMETRES)
        if inconnues:
            raise SystemExit(f"clés inconnues dans {a.config} : {', '.join(sorted(inconnues))} (clés : {', '.join(PARAMETRES)})")
        p.update(conf)
    for cle, val in vars(a).items():
        if cle in PARAMETRES and val is not None:
            p[cle] = val
    if isinstance(p["formats"], str):
        p["formats"] = [f.strip().lower() for f in p["formats"].split(",") if f.strip()]
    if isinstance(p["lods"], str):
        p["lods"] = [int(x) for x in p["lods"].split(",") if x.strip()]
    if any(l not in QUALITE for l in p["lods"]):
        raise SystemExit("niveaux de détail possibles : 0, 1, 2")
    if any(f not in ("glb", "fbx", "blend") for f in p["formats"]):
        raise SystemExit("formats possibles : glb, fbx, blend")
    p["tous"], p["liste"] = a.tous, a.liste
    return p


def main():
    p = lire_parametres(sys.argv)
    if p["liste"]:
        print("cadres :", ", ".join(CADRES))
        print("roues  :", ", ".join(ROUES))
        print("pneus  :", ", ".join(PNEUS))
        return
    if p["tous"]:
        for cadre in CADRES:
            generer(dict(p, cadre=cadre, nom=None))
    else:
        generer(p)


if __name__ == "__main__":
    main()
