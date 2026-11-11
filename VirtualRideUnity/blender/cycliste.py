"""Wattlas — cycliste pour Unity : corps, tenues, équipements et animations de pédalage, construits par Blender.

Même méthode que le cycliste de la vue réaliste (VirtualRide3DRealiste/monde/js/body.js) : le corps est une seule surface
continue, tirée d'un champ de distance (formes arrondies fondues entre elles), extraite en maillage (« surface nets »),
rattachée à un squelette de 15 os avec des poids lissés aux articulations. La tenue se lit par zones (bandes le long des
membres) : manches, cuissard, chaussettes et gants changent avec une palette de couleurs, sans changer le maillage.

Sortent dans un seul fichier (.fbx et/ou .glb) :
  - le squelette (noms d'os de Unity : Hips, Spine, Head, LeftUpperArm…, reconnus par l'avatar Humanoid) ;
  - le corps en trois niveaux de détail (Corps_LOD0/1/2), homme ou femme ;
  - tous les équipements du magasin, chacun attaché à son os, à activer dans Unity (CyclisteEquipement.cs) :
    casques road, city, aero, tt ; lunettes sport, shield ; chaussures flat, mtb, road, carbon, aero ; cheveux ;
  - les animations : un tour de pédalier par clip, pour chaque position du magasin (upright, tops, hoods, hoods_bent,
    drops, forearms) et en danseuse (hoods, drops). Unity règle le temps du clip sur l'angle du pédalier.

Les animations sont calculées pour un vélo donné (géométrie de velo_route.py) : les pieds tombent sur les pédales et les
mains sur le cintre. La hauteur de selle est ajustée à la longueur des jambes (genou à 145° en bas du coup de pédale).

Lancer (Blender 4.2 ou plus récent) :
  blender -b -P cycliste.py -- --sexe f --cadre aero --apercu
  python cycliste.py --sexe m --tenue skinsuit --avec-velo      (module bpy)

Repère : celui du vélo (1 unité = 1 m, origine au sol au milieu de l'empattement) : dans Unity, le cycliste se pose comme
enfant du vélo, sans décalage.
"""
import argparse
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import velo_route as VR  # noqa: E402
from velo_route import AV, HAUT, LAT, vers_blender, vers_unity  # noqa: E402

# ---------------------------------------------------------------------------------------------------
# Catalogue : identifiants du magasin de Wattlas (Commun/js/engine/catalog.js, physics.js)

CASQUES = ["road", "city", "aero", "tt"]
TENUES = ["loose", "fitted", "aero", "skinsuit", "skinsuit_tt"]
LUNETTES = ["none", "sport", "shield"]
CHAUSSETTES = ["short", "classic", "aero"]
CHAUSSURES = ["flat", "mtb", "road", "carbon", "aero"]
POSITIONS = {  # prise des mains, extension des bras (1 = tendus), comme POSITIONS de bike.js
    "upright": ("Ancre_MainD_Haut", 1.0),
    "tops": ("Ancre_MainD_Haut", 0.97),
    "hoods": ("Ancre_MainD_Cocotte", 0.97),
    "hoods_bent": ("Ancre_MainD_Cocotte", 0.8),
    "drops": ("Ancre_MainD_Bas", 0.86),
    "forearms": (None, None),
}
CLIPS = [(f"Pedalage_{pos}", pos, False) for pos in POSITIONS] + [("Danseuse_hoods", "hoods", True), ("Danseuse_drops", "drops", True)]
IMAGES_PAR_TOUR = 36   # clés par tour de pédalier (une toutes les 10°) ; le clip dure 1 s à 36 images/s

# Os : nom (avatar Humanoid de Unity), parent. Repère de Blender : Y le long de l'os.
OS = [("Hips", None), ("Spine", "Hips"), ("Head", "Spine"),
      ("LeftUpperArm", "Spine"), ("LeftLowerArm", "LeftUpperArm"), ("LeftHand", "LeftLowerArm"),
      ("RightUpperArm", "Spine"), ("RightLowerArm", "RightUpperArm"), ("RightHand", "RightLowerArm"),
      ("LeftUpperLeg", "Hips"), ("LeftLowerLeg", "LeftUpperLeg"), ("LeftFoot", "LeftLowerLeg"),
      ("RightUpperLeg", "Hips"), ("RightLowerLeg", "RightUpperLeg"), ("RightFoot", "RightLowerLeg")]
NOMS_OS = [o for o, _ in OS]
IO = {o: i for i, o in enumerate(NOMS_OS)}
COTES = (("Left", -1), ("Right", 1))

PARAMETRES = {
    "nom": None,                 # défaut : Cycliste_M ou Cycliste_F
    "sexe": "m",
    "taille_cycliste": None,     # m ; défaut 1,78 (homme) ou 1,68 (femme)
    "peau": "#C99A7A",
    "cheveux": "#4A3423",
    "maillot": "#C8102E",
    "maillot_accent": "#F2F2F2",
    "cuissard": "#16161A",
    "gants": "#16161A",
    "couleur_chaussettes": "#F2F2F2",
    "couleur_casque": "#F2F2F2",
    "couleur_chaussures": "#F2F2F2",
    "motif": "bande",            # "uni" ou "bande" (bande d'accent sur la poitrine et aux manches)
    # équipement montré par défaut et dans la palette par défaut (tous les équipements sont exportés)
    "tenue": "fitted", "chaussettes": "classic", "casque": "road", "lunettes": "sport", "chaussures": "road",
    "velo": {},                  # paramètres de velo_route.py (cadre, roues, taille_cm…) ; la hauteur de selle est calculée
    "lods": [0, 1, 2],
    "formats": ["fbx", "glb"],
    "sortie": "sortie",
    "apercu": False,
    "avec_velo": False,          # exporte aussi le vélo correspondant (même hauteur de selle)
}

# ---------------------------------------------------------------------------------------------------
# Texture de la tenue : 16 rangées de 4 px sur 64 px de large. Une rangée par partie du corps ; en largeur, la
# position le long du membre (0 = articulation du haut, 1 = articulation du bas). Chaque sommet porte sa position :
# la limite d'une manche, du cuissard ou d'une chaussette tombe au pixel près, droite, quel que soit le maillage.
# Les équipements ont chacun leur rangée, d'une seule couleur. Même table dans Unity (CyclisteTenue.cs).

RANGEES = ["tronc", "tete", "bras", "avantbras", "main", "cuisse", "jambe", "casque", "jugulaire", "verre", "monture",
           "chaussure", "semelle", "couvre_chaussure", "cheveux", "oeil"]
R = {nom: i for i, nom in enumerate(RANGEES)}
LARGEUR, HAUTEUR_RANGEE = 64, 4
TRONC_MAX = 1.3          # le tronc va du bassin (0) au cou (1) et au-delà jusqu'à 1,3 (le cou, en peau)


def uv_rangee(rangee, s=0.5):
    return (min(0.999, max(0.001, s)), (rangee + 0.5) / len(RANGEES))


def couleur_rangee(p, rangee, s):
    """Couleur (sRGB), métal et rugosité d'un point de la texture : rangée, position s ∈ [0, 1] le long du membre.
    Même logique que regionOf de body.js : manches, cuissard, chaussettes et gants selon la tenue."""
    hx = VR.hex_srgb
    peau, maillot, accent = (hx(p["peau"]), 0.0, 0.55), (hx(p["maillot"]), 0.0, 0.45), (hx(p["maillot_accent"]), 0.0, 0.45)
    cuissard, gant, chaussette = (hx(p["cuissard"]), 0.0, 0.5), (hx(p["gants"]), 0.0, 0.6), (hx(p["couleur_chaussettes"]), 0.0, 0.7)
    tenue = p["tenue"]
    longues = tenue == "skinsuit_tt"
    bande = p["motif"] == "bande"
    nom = RANGEES[rangee]
    if nom == "tronc":
        t = s * TRONC_MAX
        if t > 1.0:
            return peau
        if t < 0.2:   # sous la taille : cuissard (aussi pour une combinaison, dont le bas est foncé)
            return cuissard
        return accent if bande and 0.55 <= t < 0.68 else maillot
    if nom == "tete":
        return peau
    if nom == "bras":
        manche = {"loose": 0.65, "aero": 0.85, "skinsuit": 0.85}.get(tenue, 0.55)
        if longues:
            return maillot
        if s < manche:
            return accent if bande and s >= manche - 0.1 else maillot
        return peau
    if nom == "avantbras":
        if longues and s < 0.92:
            return accent if bande and s >= 0.82 else maillot
        return peau
    if nom == "main":
        return gant if 0.15 <= s < 0.52 else peau
    if nom == "cuisse":
        return cuissard if s < 0.84 else peau
    if nom == "jambe":
        haut = {"short": 0.12, "classic": 0.3, "aero": 0.42}[p["chaussettes"]]
        return chaussette if s > 1 - haut else peau
    if nom == "casque":
        return (hx(p["couleur_casque"]), 0.0, 0.25)
    if nom == "jugulaire":
        return ((0.05, 0.05, 0.05), 0.0, 0.7)
    if nom == "verre":
        return ((0.10, 0.12, 0.16), 0.8, 0.06)
    if nom == "monture":
        return ((0.05, 0.05, 0.05), 0.0, 0.35)
    if nom == "chaussure":
        return {"flat": ((0.45, 0.45, 0.47), 0.0, 0.8), "mtb": ((0.22, 0.22, 0.23), 0.0, 0.6),
                "carbon": ((0.04, 0.04, 0.045), 0.0, 0.25)}.get(p["chaussures"], (hx(p["couleur_chaussures"]), 0.0, 0.35))
    if nom == "semelle":
        return ((0.85, 0.85, 0.83), 0.0, 0.8) if p["chaussures"] == "flat" else ((0.06, 0.06, 0.06), 0.0, 0.5)
    if nom == "couvre_chaussure":
        return ((0.04, 0.04, 0.045), 0.0, 0.45)
    if nom == "cheveux":
        return (hx(p["cheveux"]), 0.0, 0.6)
    return ((0.05, 0.04, 0.035), 0.0, 0.15)  # oeil


def ecrire_palette(images, p):
    """Remplit les trois images (couleur, métal/rugosité glTF, métal/lissé URP) d'après la tenue et l'équipement."""
    haut = HAUTEUR_RANGEE * len(RANGEES)
    px_c, px_mr, px_u = (np.zeros((haut, LARGEUR, 4), dtype=np.float32) for _ in range(3))
    for r in range(len(RANGEES)):
        for x in range(LARGEUR):
            srgb, metal, rug = couleur_rangee(p, r, (x + 0.5) / LARGEUR)
            sl = (slice(r * HAUTEUR_RANGEE, (r + 1) * HAUTEUR_RANGEE), x)
            px_c[sl] = (*srgb, 1.0)
            px_mr[sl] = (0.0, rug, metal, 1.0)
            px_u[sl] = (metal, metal, metal, 1.0 - rug)
    for cle, px in (("Palette", px_c), ("MetalRugosite", px_mr), ("MetalLisse", px_u)):
        images[cle].pixels.foreach_set(px.ravel())
        images[cle].update()


def creer_palette(nom, p, dossier):
    images = {}
    for suffixe, espace, alpha in (("Palette", "sRGB", False), ("MetalRugosite", "Non-Color", False), ("MetalLisse", "Non-Color", True)):
        img = bpy.data.images.new(f"{nom}_{suffixe}", LARGEUR, HAUTEUR_RANGEE * len(RANGEES), alpha=alpha)
        img.colorspace_settings.name = espace
        img.filepath_raw = os.path.join(dossier, f"{nom}_{suffixe}.png")
        img.file_format = "PNG"
        images[suffixe] = img
    ecrire_palette(images, p)
    for img in images.values():
        img.save()
    return images


# ---------------------------------------------------------------------------------------------------
# Morphologie (proportions de body.js : cycliste de 1,78 m, cycliste de 1,68 m)

def morphologie(sexe, taille):
    f = sexe == "f"
    ref = 1.68 if f else 1.78
    k = (taille or ref) / ref
    M = {"f": f, "epaule": 0.168 if f else 0.19, "hanche": 0.1 if f else 0.092, "bras": 0.285 if f else 0.3,
         "avant_bras": 0.27 if f else 0.285, "cuisse": 0.44 if f else 0.46, "jambe": 0.43 if f else 0.45,
         "torse": 0.56 if f else 0.59, "poitrine_l": 0.155 if f else 0.175, "poitrine_p": 0.105 if f else 0.115,
         "taille_l": 0.12 if f else 0.135, "bassin_l": 0.165 if f else 0.15, "fessier": 0.098 if f else 0.088,
         "r_bras": 0.036 if f else 0.042, "r_cuisse": 0.078 if f else 0.082, "r_mollet": 0.052 if f else 0.056,
         "tete": 0.95 if f else 1.0}
    for cle in M:
        if cle not in ("f",):
            M[cle] *= k
    M["k"] = k
    return M


# ---------------------------------------------------------------------------------------------------
# Articulations : plan de la position (bassin, épaules, mains) puis pose pour un angle de pédalier

def ik(a, b, l1, l2, pli):
    """Cinématique inverse à deux segments : position du genou ou du coude, et normale du plan du membre."""
    d = b - a
    dist = max(abs(l1 - l2) + 1e-3, min(l1 + l2 - 1e-3, d.length))
    d = d.normalized()
    cos_a = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
    ang = math.acos(max(-1.0, min(1.0, cos_a)))
    perp = (pli - d * pli.dot(d)).normalized()
    milieu = a + d * (math.cos(ang) * l1) + perp * (math.sin(ang) * l1)
    return milieu, d.cross(perp).normalized()


def tourner(v, axe, angle):
    return Matrix.Rotation(angle, 3, axe) @ v


def plan_position(A, M, pos, debout):
    """Bassin, épaule (milieu), mains et coudes pour une position du magasin (comme plan() de bike.js)."""
    prise, e = POSITIONS[pos]
    bassin = A["Ancre_Selle"] + AV * 0.06 + HAUT * 0.075
    C_ = A["cintre"]
    coudes = None
    if prise is None:  # avant-bras posés sur le dessus du cintre, mains vers l'avant
        mains = [C_ + Vector((-0.10, 0.24, 0.035)), C_ + Vector((0.10, 0.24, 0.035))]
        coudes = [C_ + Vector((-0.14, -0.02, 0.05)), C_ + Vector((0.14, -0.02, 0.05))]
        a = math.asin(max(0.05, min(0.95, (coudes[1].z + 0.28 - bassin.z) / M["torse"])))
    else:
        d = A[prise]
        mains = [Vector((-d.x, d.y, d.z)), d.copy()]
        h = mains[1]
        allonge = (M["bras"] + M["avant_bras"]) * 1.02 * e
        lo, hi = 0.08, 1.3
        for _ in range(26):
            a = (lo + hi) / 2
            ep = bassin + AV * (M["torse"] * math.cos(a) - 0.03) + HAUT * (M["torse"] * math.sin(a) - 0.03)
            dist = math.sqrt((abs(h.x) - M["epaule"]) ** 2 + (h.y - ep.y) ** 2 + (h.z - ep.z) ** 2)
            if dist < allonge:
                lo = a
            else:
                hi = a
    epaule = bassin + AV * (M["torse"] * math.cos(a)) + HAUT * (M["torse"] * math.sin(a))
    if debout:
        bassin = bassin + AV * 0.2 + HAUT * 0.16
        epaule = epaule + AV * 0.1 + HAUT * 0.06
    return {"bassin": bassin, "epaule": epaule, "mains": mains, "coudes": coudes}


def pedale(A, cote, theta, L):
    """Axe de la pédale (cote : -1 gauche, +1 droite) ; theta = 0 : manivelle droite vers l'avant, puis vers le bas."""
    th = theta if cote > 0 else theta + math.pi
    return A["bb"] + LAT * (0.11 * cote) + (AV * math.cos(th) - HAUT * math.sin(th)) * L, th


def articulations(P, theta, A, M, debout=False, pli_tete=0.0):
    """Toutes les articulations pour un angle de pédalier (radians), et les normales des plans des membres."""
    J, plans = {}, {}
    bassin, epaule = P["bassin"].copy(), P["epaule"].copy()
    roulis = 0.0
    if debout:  # en danseuse, le haut du corps reste droit pendant que le vélo se balance sous lui (roulis dans Unity)
        roulis = math.radians(5.0) * math.sin(theta + math.pi / 4)
        for v in (bassin, epaule):
            v -= A["bb"]
            v.rotate(Matrix.Rotation(roulis, 3, AV))
            v += A["bb"]
    else:  # assis : le bassin roule à peine avec le coup de pédale
        roulis = math.radians(1.5) * math.sin(theta)
    lat = tourner(LAT.copy(), AV, roulis)
    tdir = (epaule - bassin).normalized()
    dos = Vector((0.0, -tdir.z, tdir.y))
    J["bassin"] = bassin
    J["poitrine"] = bassin + tdir * ((epaule - bassin).length * 0.5) + dos * 0.035
    J["cou"] = epaule + tdir * 0.04 + Vector((0.0, 0.02, 0.03)) * M["k"]
    ha = math.atan2(tdir.z, tdir.y) + 0.32 - pli_tete * 0.15
    J["tete"] = J["cou"] + (AV * math.cos(ha) + HAUT * math.sin(ha)) * (0.13 * M["k"])
    J["lat"] = lat
    for nom, s in COTES:
        ep = epaule + lat * (s * M["epaule"]) + AV * (-0.03) + HAUT * (-0.03)
        main = P["mains"][0 if s < 0 else 1]
        if P["coudes"] is not None:
            coude = P["coudes"][0 if s < 0 else 1]
            n = (main - coude).cross(coude - ep)
            n = n.normalized() if n.length > 1e-6 else LAT.copy()
        else:
            coude, n = ik(ep, main, M["bras"], M["avant_bras"], Vector((s * 0.6, -0.7, -0.35)).normalized())
        fdir = (main - coude).normalized()
        J[nom + "Epaule"], J[nom + "Coude"] = ep, coude
        J[nom + "Poignet"], J[nom + "Doigts"] = main - fdir * 0.045, main + fdir * 0.05
        plans[nom + "Bras"] = n
    L = A["manivelle"]
    for nom, s in COTES:
        ped, th = pedale(A, s, theta, L)
        # cheville et pointe du pied autour de la pédale ; le pied s'incline au fil du tour (talon bas en poussant)
        incl = -0.12 * math.cos(th - math.radians(225))
        cheville = ped + tourner(Vector((0.0, -0.06, 0.075)) * M["k"], LAT, incl)
        pointe = ped + tourner(Vector((0.0, 0.10, 0.03)) * M["k"], LAT, incl)
        hanche = bassin + lat * (s * M["hanche"]) + AV * 0.02 + HAUT * (-0.03)
        genou, n = ik(hanche, cheville, M["cuisse"], M["jambe"], Vector((s * 0.1, 1.0, 0.25)).normalized())
        J[nom + "Hanche"], J[nom + "Genou"], J[nom + "Cheville"], J[nom + "Pointe"], J[nom + "Pedale"] = hanche, genou, cheville, pointe, ped
        plans[nom + "Jambe"] = n
    return J, plans


def extremites_os(J, plans):
    """Pour chaque os : tête, queue, axe X souhaité (le plan du membre, ou le côté pour le tronc)."""
    lat = J["lat"]
    E = {"Hips": (J["bassin"], J["poitrine"], lat), "Spine": (J["poitrine"], J["cou"], lat), "Head": (J["cou"], J["tete"], lat)}
    for nom, _ in COTES:
        nb, nj = plans[nom + "Bras"], plans[nom + "Jambe"]
        E[nom + "UpperArm"] = (J[nom + "Epaule"], J[nom + "Coude"], nb)
        E[nom + "LowerArm"] = (J[nom + "Coude"], J[nom + "Poignet"], nb)
        E[nom + "Hand"] = (J[nom + "Poignet"], J[nom + "Doigts"], nb)
        E[nom + "UpperLeg"] = (J[nom + "Hanche"], J[nom + "Genou"], nj)
        E[nom + "LowerLeg"] = (J[nom + "Genou"], J[nom + "Cheville"], nj)
        E[nom + "Foot"] = (J[nom + "Cheville"], J[nom + "Pointe"], nj)
    return E


def repere_os(tete, queue, xs):
    """Matrice 4×4 (repère Blender) : Y le long de l'os, X selon xs projeté, Z = X × Y."""
    y = vers_blender(queue - tete).normalized()
    x = vers_blender(xs)
    x = (x - y * x.dot(y))
    if x.length < 1e-6:
        x = vers_blender(LAT) - y * vers_blender(LAT).dot(y)
    x.normalize()
    z = x.cross(y)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = vers_blender(tete)
    return m


# ---------------------------------------------------------------------------------------------------
# Champ de distance (numpy) : primitives du corps et des équipements

def W(a, b, c):
    """Vecteur écrit dans le repère de body.js (x droite, y haut, z avant) → repère cycliste."""
    return Vector((a, c, b))


def _np(v):
    return np.array([v[0], v[1], v[2]], dtype=np.float64)


def sd_cone(P, a, b, r1, r2):
    """Cône arrondi entre a (rayon r1) et b (rayon r2) (Inigo Quilez)."""
    a, b = _np(a), _np(b)
    ba = b - a
    l2 = ba @ ba
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = P - a
    y = pa @ ba
    z = y - l2
    q = pa * l2 - np.outer(y, ba)
    x2 = np.einsum("ij,ij->i", q, q)
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    d1 = np.sqrt(x2 + z2) * il2 - r2
    d2 = np.sqrt(x2 + y2) * il2 - r1
    d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0.0)) + y * rr) * il2 - r1
    return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))


def ellipsoide(c, le_long, lateral, rx, ry, rz):
    v = le_long.normalized()
    u = (lateral - v * lateral.dot(v)).normalized()
    w = u.cross(v).normalized()
    return {"c": _np(c), "u": _np(u), "v": _np(v), "w": _np(w), "r": np.array([rx, ry, rz])}


def sd_ellipsoide(P, E):
    d = P - E["c"]
    x, y, z = d @ E["u"], d @ E["v"], d @ E["w"]
    rx, ry, rz = E["r"]
    k0 = np.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2)
    k1 = np.sqrt((x / rx ** 2) ** 2 + (y / ry ** 2) ** 2 + (z / rz ** 2) ** 2)
    return np.where(k1 > 1e-9, k0 * (k0 - 1) / np.maximum(k1, 1e-12), -min(rx, ry, rz))


def smin(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def prims_corps(J, M):
    """Primitives du corps dans la pose J (comme bodyPrims de body.js) : os, partie, fonction de distance, axe, lissage."""
    P = []

    def add(os_, partie, f, a=None, b=None, k=0.04):
        P.append({"os": os_, "partie": partie, "f": f, "a": a, "b": b, "k": k})

    def cone(os_, partie, a, b, r1, r2, k=0.04, axe=None):
        add(os_, partie, lambda X, a=a, b=b, r1=r1, r2=r2: sd_cone(X, a, b, r1, r2), *(axe or (a, b)), k)

    def ell(os_, partie, E, k, a=None, b=None):
        add(os_, partie, lambda X, E=E: sd_ellipsoide(X, E), a, b, k)

    lat = LAT
    tdir = (J["cou"] - J["bassin"]).normalized()
    avant_buste = Vector((0.0, tdir.z, -tdir.y)) * -1          # vers le ventre
    hs, k = M["tete"], M["k"]
    H = J["tete"]
    # tête : crâne, mâchoire, nez, oreilles ; cou
    ell("Head", "tete", ellipsoide(H, W(0, 1, 0.25), lat, 0.074 * hs, 0.1 * hs, 0.092 * hs), 0.03)
    ell("Head", "tete", ellipsoide(H + W(0, -0.055, 0.035) * hs, W(0, 1, 0.5), lat, 0.055 * hs, 0.05 * hs, 0.06 * hs), 0.04)
    cone("Head", "tete", H + W(0, -0.005, 0.085) * hs, H + W(0, -0.035, 0.105) * hs, 0.008, 0.012, 0.015)
    for sx in (-1, 1):
        ell("Head", "tete", ellipsoide(H + W(sx * 0.074, -0.005, -0.005) * hs, W(0, 1, 0), lat, 0.012, 0.03, 0.02), 0.012)
    cone("Head", "cou", J["cou"] - tdir * 0.04, H + W(0, -0.04, -0.02), 0.058 * k, 0.05 * k, 0.05)
    # buste : cage thoracique, épaules, ventre, bassin et fessiers posés sur la selle
    axe_buste = (J["bassin"], J["cou"])
    ell("Spine", "torse", ellipsoide(J["poitrine"] + tdir * 0.09, tdir, lat, M["poitrine_l"], 0.16 * k, M["poitrine_p"]), 0.08, *axe_buste)
    if M["f"]:
        for sx in (-1, 1):
            ell("Spine", "torse", ellipsoide(J["poitrine"] + tdir * 0.07 + LAT * (sx * 0.07) + avant_buste * 0.085, tdir, lat,
                                             0.055 * k, 0.05 * k, 0.05 * k), 0.04, *axe_buste)
    ell("Hips", "torse", ellipsoide(J["bassin"] + tdir * 0.17, tdir, lat, M["taille_l"], 0.14 * k, 0.1 * k), 0.08, *axe_buste)
    ell("Hips", "hanches", ellipsoide(J["bassin"] + tdir * 0.04, tdir, lat, M["bassin_l"], 0.1 * k, 0.11 * k), 0.07, *axe_buste)
    for sx in (-1, 1):
        ell("Hips", "fessier", ellipsoide(J["bassin"] + W(sx * 0.07, -0.02, -0.06) * k, W(0, 1, 0.3), lat,
                                          M["fessier"] * 0.9, M["fessier"], M["fessier"] * 0.95), 0.05)
        ell("Spine", "torse", ellipsoide(J["cou"] + W(sx * 0.075, -0.045, -0.035) * k, W(sx, -0.35, 0), W(0, 1, 0),
                                         0.032 * k, 0.075 * k, 0.042 * k), 0.05, *axe_buste)
    # bras
    for nom, sx in COTES:
        ep, co, po, do = J[nom + "Epaule"], J[nom + "Coude"], J[nom + "Poignet"], J[nom + "Doigts"]
        ell(nom + "UpperArm", "epaule", ellipsoide(ep + LAT * (sx * 0.008) + (co - ep) * 0.12, co - ep, lat, 0.046 * k, 0.075 * k, 0.046 * k),
            0.05, ep, co)
        cone(nom + "UpperArm", "bras", ep, co, M["r_bras"], M["r_bras"] * 0.78, 0.05)
        ell(nom + "UpperArm", "bras", ellipsoide(ep.lerp(co, 0.55), co - ep, lat, M["r_bras"] * 0.95, 0.09 * k, M["r_bras"]), 0.03, ep, co)
        cone(nom + "LowerArm", "avantbras", co, po, M["r_bras"] * 0.82, M["r_bras"] * 0.58, 0.035)
        ell(nom + "LowerArm", "avantbras", ellipsoide(co.lerp(po, 0.3), po - co, lat, M["r_bras"] * 0.85, 0.08 * k, M["r_bras"] * 0.8),
            0.03, co, po)
        # main fermée sur le cintre
        ell(nom + "Hand", "main", ellipsoide(po.lerp(do, 0.55), do - po, lat, 0.03 * k, 0.055 * k, 0.038 * k), 0.02, po, do)
        cone(nom + "Hand", "main", po.lerp(do, 0.4), do + HAUT * (-0.025 * k), 0.022 * k, 0.018 * k, 0.02, axe=(po, do))
    # jambes : cuisse (quadriceps, vaste interne), genou, mollet ; pied (caché par la chaussure)
    for nom, sx in COTES:
        ha, ge, ch, pt = J[nom + "Hanche"], J[nom + "Genou"], J[nom + "Cheville"], J[nom + "Pointe"]
        cd = (ge - ha).normalized()
        devant_cuisse = Vector((0.0, -cd.z, cd.y))
        cone(nom + "UpperLeg", "cuisse", ha, ge, M["r_cuisse"], M["r_cuisse"] * 0.62, 0.05)
        ell(nom + "UpperLeg", "cuisse", ellipsoide(ha.lerp(ge, 0.5) + devant_cuisse * 0.022 * k, cd, lat,
                                                   M["r_cuisse"] * 0.92, 0.2 * k, M["r_cuisse"] * 0.85), 0.04, ha, ge)
        ell(nom + "UpperLeg", "cuisse", ellipsoide(ha.lerp(ge, 0.82) + devant_cuisse * 0.012 * k + LAT * (-sx * 0.025 * k), cd, lat,
                                                   0.04 * k, 0.06 * k, 0.04 * k), 0.03, ha, ge)
        jd = (ch - ge).normalized()
        arriere_jambe = Vector((0.0, jd.z, -jd.y))
        cone(nom + "LowerLeg", "jambe", ge, ch, M["r_mollet"] * 0.85, M["r_mollet"] * 0.48, 0.03)
        ell(nom + "LowerLeg", "jambe", ellipsoide(ge.lerp(ch, 0.32) + arriere_jambe * 0.022 * k, jd, lat,
                                                  M["r_mollet"] * 0.95, 0.11 * k, M["r_mollet"] * 0.95), 0.035, ge, ch)
        ell(nom + "LowerLeg", "genou", ellipsoide(ge - arriere_jambe * 0.01 * k, jd, lat, 0.045 * k, 0.05 * k, 0.045 * k), 0.03, ge, ch)
        cone(nom + "Foot", "pied", ch + HAUT * (-0.02) + AV * (-0.02), pt + HAUT * (-0.005) + AV * (-0.02), 0.032 * k, 0.025 * k, 0.02,
             axe=(ch, pt))
    return P


def champ(prims, X):
    d = None
    for p in prims:
        v = p["f"](X)
        d = v if d is None else smin(d, v, p["k"])
    return d


# ---------------------------------------------------------------------------------------------------
# Extraction du maillage : « surface nets » (un sommet par cellule traversée, une face par arête traversée)

COINS = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]])
ARETES = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]


def surface_nets(f, mini, maxi, h):
    """Maillage (sommets, quads) de la surface f = 0 dans la boîte [mini, maxi], pas h ; sommets reprojetés sur la surface."""
    n = np.ceil((np.array(maxi) - np.array(mini)) / h).astype(int) + 1
    gx, gy, gz = (mini[i] + np.arange(n[i]) * h for i in range(3))
    X = np.stack(np.meshgrid(gx, gy, gz, indexing="ij"), -1).reshape(-1, 3)
    F = f(X).reshape(n)
    neg = F < 0
    c = [neg[i:n[0] - 1 + i, j:n[1] - 1 + j, k:n[2] - 1 + k] for i, j, k in COINS]
    compte = sum(ci.astype(np.int8) for ci in c)
    ci, cj, ck = np.nonzero((compte > 0) & (compte < 8))
    vals = [F[ci + i, cj + j, ck + k] for i, j, k in COINS]
    somme, nb = np.zeros((len(ci), 3)), np.zeros(len(ci))
    for a, b in ARETES:
        va, vb = vals[a], vals[b]
        m = (va < 0) != (vb < 0)
        t = va[m] / (va[m] - vb[m])
        somme[m] += COINS[a] + t[:, None] * (COINS[b] - COINS[a])
        nb[m] += 1
    pos = np.array(mini) + (np.stack([ci, cj, ck], 1) + somme / nb[:, None]) * h
    vid = np.full(n - 1, -1, dtype=np.int64)
    vid[ci, cj, ck] = np.arange(len(ci))
    quads = []
    ex = neg[:-1, 1:-1, 1:-1] != neg[1:, 1:-1, 1:-1]
    i, j, k = np.nonzero(ex)
    j, k = j + 1, k + 1
    quads.append(np.stack([vid[i, j - 1, k - 1], vid[i, j, k - 1], vid[i, j, k], vid[i, j - 1, k]], 1))
    ey = neg[1:-1, :-1, 1:-1] != neg[1:-1, 1:, 1:-1]
    i, j, k = np.nonzero(ey)
    i, k = i + 1, k + 1
    quads.append(np.stack([vid[i - 1, j, k - 1], vid[i - 1, j, k], vid[i, j, k], vid[i, j, k - 1]], 1))
    ez = neg[1:-1, 1:-1, :-1] != neg[1:-1, 1:-1, 1:]
    i, j, k = np.nonzero(ez)
    i, j = i + 1, j + 1
    quads.append(np.stack([vid[i - 1, j - 1, k], vid[i, j - 1, k], vid[i, j, k], vid[i - 1, j, k]], 1))
    Q = np.concatenate(quads)
    Q = Q[(Q >= 0).all(1)]
    # deux reprojections de Newton sur la surface
    e = h * 0.25
    for _ in range(2):
        d0 = f(pos)
        grad = np.stack([(f(pos + o) - f(pos - o)) / (2 * e) for o in np.eye(3) * e], 1)
        g2 = np.maximum((grad ** 2).sum(1), 1e-9)
        pas = np.clip(d0 / g2, -h, h)
        pos = pos - grad * pas[:, None]
    # faces tournées vers l'extérieur (gradient du champ)
    centres = pos[Q].mean(1)
    grad = np.stack([(f(centres + o) - f(centres - o)) / (2 * e) for o in np.eye(3) * e], 1)
    nrm = np.cross(pos[Q[:, 1]] - pos[Q[:, 0]], pos[Q[:, 2]] - pos[Q[:, 0]])
    retour = (nrm * grad).sum(1) < 0
    Q[retour] = Q[retour][:, ::-1]
    return pos, Q


def boite_serree(f, mini, maxi, h=0.02):
    n = np.ceil((np.array(maxi) - np.array(mini)) / h).astype(int) + 1
    X = np.stack(np.meshgrid(*(mini[i] + np.arange(n[i]) * h for i in range(3)), indexing="ij"), -1).reshape(-1, 3)
    dedans = X[f(X) < h]
    if len(dedans) == 0:
        return None
    return (dedans.min(0) - 2 * h).tolist(), (dedans.max(0) + 2 * h).tolist()


# ---------------------------------------------------------------------------------------------------
# Équipements (dans la pose de référence ; chacun suit un seul os)

def coque(c, u, v, w, r, phi, elev, ep, nphi=16, nelev=5):
    """Portion d'ellipsoïde (verre, visière) : u latéral, v haut, w avant ; phi : ouverture latérale (rad),
    elev : (bas, haut) en rad ; épaisseur ep vers l'intérieur. Maillage fermé : (sommets, faces)."""
    verts, faces = [], []

    def grille(echelle):
        b = len(verts)
        for i in range(nelev + 1):
            el = elev[0] + (elev[1] - elev[0]) * i / nelev
            for j in range(nphi + 1):
                ph = -phi + 2 * phi * j / nphi
                verts.append(c + u * (r[0] * echelle * math.sin(ph) * math.cos(el)) + w * (r[2] * echelle * math.cos(ph) * math.cos(el))
                             + v * (r[1] * echelle * math.sin(el)))
        return b

    ext = grille(1.0)
    inte = grille(1.0 - ep / min(r))
    m = nphi + 1
    for i in range(nelev):
        for j in range(nphi):
            a = i * m + j
            faces.append((ext + a, ext + a + m, ext + a + m + 1, ext + a + 1))
            faces.append((inte + a, inte + a + 1, inte + a + m + 1, inte + a + m))
    bord = [i * m for i in range(nelev + 1)] + [nelev * m + j for j in range(1, m)] + \
        [i * m + nphi for i in range(nelev - 1, -1, -1)] + [j for j in range(nphi - 1, 0, -1)]
    for t in range(len(bord)):
        a, b = bord[t], bord[(t + 1) % len(bord)]
        faces.append((ext + a, inte + a, inte + b, ext + b))
    return verts, faces


def devant_visage(prims, H, dz, dx=0.0):
    """Distance, vers l'avant depuis le centre de la tête, où l'on sort du visage (à la hauteur H.z + dz)."""
    ds = np.linspace(0.0, 0.2, 401)
    X = np.array([[H.x + dx, H.y + d, H.z + dz] for d in ds])
    dehors = np.nonzero(champ(prims, X) > 0)[0]
    return float(ds[dehors[0]]) if len(dehors) else 0.1


def prims_equipements(J, M, prims):
    """Équipements : {nom d'objet: (os, [(fonction de distance | maillage explicite, case, pas)])}."""
    hs = M["tete"]
    H = J["tete"]
    yeux_z = 0.012 * hs
    face = devant_visage(prims, H, yeux_z, 0.031 * hs)   # devant de l'œil
    face_c = devant_visage(prims, H, yeux_z)             # arête du nez
    lat = LAT
    E = {}

    def coque_casque(X, decoupes):
        Ec = ellipsoide(H + W(0, 0.02, -0.005) * hs, W(0, 1, 0.15), lat, 0.098 * hs, 0.11 * hs, 0.135 * hs)
        d = sd_ellipsoide(X, Ec)
        d = np.maximum(d, -(d + 0.018))
        # bord du casque : sur le front à l'avant (au-dessus des lunettes), plus bas derrière la tête
        bord = H.z - 0.005 * hs + np.maximum(0, X[:, 1] - H.y) * 0.5 - np.maximum(0, H.y - X[:, 1]) * 0.2
        d = np.maximum(d, bord - X[:, 2])
        for cx, long_ in decoupes:
            vz = np.abs(X[:, 1] - H.y - 0.01) - long_
            vx = np.abs(X[:, 0] - H.x - cx) - 0.008
            d = np.maximum(d, -np.maximum(np.maximum(vz, vx), H.z + 0.06 * hs - X[:, 2]))
        return d

    def jugulaires():
        out = []
        for sx in (-1, 1):
            out.append(("tube", [H + W(sx * 0.072, 0.0, 0.0) * hs, H + W(sx * 0.03, -0.1, 0.05) * hs], 0.0045, "jugulaire"))
        return out

    E["Casque_road"] = ("Head", [(lambda X: coque_casque(X, [(-0.05, 0.06), (-0.017, 0.06), (0.017, 0.06), (0.05, 0.06)]), "casque", 0.0045)]
                        + jugulaires())

    def casque_ville(X):
        d = coque_casque(X, [(-0.03, 0.04), (0.03, 0.04)])
        visiere = sd_ellipsoide(X, ellipsoide(H + W(0, 0.035, 0.115) * hs, W(0, 0.2, 1), lat, 0.07 * hs, 0.045 * hs, 0.012))
        return smin(d, visiere, 0.01)
    E["Casque_city"] = ("Head", [(casque_ville, "casque", 0.0045)] + jugulaires())

    def casque_aero(X):
        d = coque_casque(X, [])
        bosse = sd_cone(X, H + W(0, 0.07, -0.03) * hs, H + W(0, 0.05, -0.16) * hs, 0.06 * hs, 0.03 * hs)
        return smin(d, bosse, 0.03)
    E["Casque_aero"] = ("Head", [(casque_aero, "casque", 0.0045)] + jugulaires())

    def casque_chrono(X):
        a, b = H + W(0, 0.025, 0.015) * hs, H + W(0, -0.035, -0.26) * hs
        d = sd_cone(X, a, b, 0.112 * hs, 0.016)
        cut = (H.z - 0.04 * hs - X[:, 2]) + np.maximum(0, X[:, 1] - H.y) * 0.6 - np.maximum(0, H.y - X[:, 1]) * 0.35
        return np.maximum(d, cut)
    u, v, w = LAT, HAUT, AV
    visiere = ("coque", coque(H + W(0, 0.0, 0.035) * hs, u, v, w, (0.105 * hs, 0.075 * hs, 0.1 * hs), 1.05, (-0.75, 0.42), 0.004), "verre")
    E["Casque_tt"] = ("Head", [(casque_chrono, "casque", 0.005), visiere] + jugulaires())

    # lunettes : écran courbe devant les yeux, branches jusqu'aux oreilles
    centre_verre = H + HAUT * yeux_z + AV * (-0.01 * hs)
    r_verre = (0.09 * hs, 0.08 * hs, max(face, face_c) + 0.022 + 0.01 * hs)   # 12 mm devant le nez
    for type_, (bas, haut, ouv) in {"sport": (-0.24, 0.3, 0.95), "shield": (-0.36, 0.42, 1.12)}.items():
        verre = ("coque", coque(centre_verre, u, v, w, r_verre, ouv, (bas, haut), 0.003, 18, 4), "verre")
        branches = []
        for sx in (-1, 1):
            bout = centre_verre + LAT * (sx * r_verre[0] * math.sin(ouv)) + AV * (r_verre[2] * math.cos(ouv))
            branches.append(("tube", [bout, H + W(sx * 0.079, 0.012, -0.03) * hs, H + W(sx * 0.075, -0.005, -0.075) * hs], 0.0022, "monture"))
        E["Lunettes_" + type_] = ("Head", [verre] + branches)

    # yeux (sous les lunettes, ou seuls)
    yeux = []
    for sx in (-1, 1):
        yeux.append(("sphere", (H + LAT * (sx * 0.031 * hs) + HAUT * yeux_z + AV * (face - 0.006 * hs), 0.012 * hs), "oeil"))
    E["Yeux"] = ("Head", yeux)

    # chaussures, attachées au pied : tige arrondie, semelle rigide ; couvre-chaussure en aéro
    for nom, _ in COTES:
        ch, pt = J[nom + "Cheville"], J[nom + "Pointe"]
        dr = (pt - ch).normalized()
        talon = ch - dr * 0.055 + HAUT * (-0.03)
        bout = pt + dr * 0.04 + HAUT * (-0.012)
        pente = (bout.z - talon.z + 0.008) / max(1e-3, bout.y - talon.y)
        jd = (J[nom + "Genou"] - ch).normalized()

        def tige(X, gros=0.0, ch=ch, dr=dr, talon=talon, bout=bout):
            return smin(sd_cone(X, talon, bout, 0.043 + gros, 0.03 + gros),
                        sd_cone(X, ch + AV * (-0.01) + HAUT * 0.01, ch + dr * 0.08, 0.042 + gros, 0.036 + gros), 0.03)

        def semelle(X, ep=0.0, talon=talon, bout=bout, pente=pente):
            d = sd_cone(X, talon + HAUT * (-0.028 - ep), bout + HAUT * (-0.02 - ep), 0.03 + ep, 0.022 + ep)
            return np.maximum(d, X[:, 2] - (talon.z - 0.025 - ep + (X[:, 1] - talon.y) * pente))

        cote = "D" if nom == "Right" else "G"
        E[f"Chaussure{cote}_road"] = (nom + "Foot", [(tige, "chaussure", 0.005), (semelle, "semelle", 0.005)])
        E[f"Chaussure{cote}_carbon"] = (nom + "Foot", [(tige, "chaussure", 0.005), (semelle, "semelle", 0.005)])
        E[f"Chaussure{cote}_mtb"] = (nom + "Foot", [(lambda X, t=tige: t(X, 0.003), "chaussure", 0.005),
                                                     (lambda X, s=semelle: s(X, 0.006), "semelle", 0.005)])
        E[f"Chaussure{cote}_flat"] = (nom + "Foot", [(lambda X, t=tige: t(X, 0.006), "chaussure", 0.005),
                                                      (lambda X, s=semelle: s(X, 0.01), "semelle", 0.005)])

        def couvre(X, t=tige, ch=ch, jd=jd):
            return smin(t(X, 0.004), sd_cone(X, ch, ch + jd * 0.13, 0.046, 0.042), 0.03)
        E[f"Chaussure{cote}_aero"] = (nom + "Foot", [(couvre, "couvre_chaussure", 0.005), (semelle, "semelle", 0.005)])

    if M["f"]:  # queue de cheval sous le casque
        E["Cheveux"] = ("Head", [(lambda X: sd_cone(X, H + W(0, -0.02, -0.1) * hs, H + W(0, -0.17, -0.16) * hs, 0.03 * hs, 0.018 * hs),
                                  "cheveux", 0.005)])
    return E


# ---------------------------------------------------------------------------------------------------
# Maillages Blender

def maillage_blender(nom, verts, faces, rangees_faces=None):
    """Maillage Blender (sommets en repère cycliste) ; UV : la rangée de chaque face (équipements, une seule couleur)."""
    me = bpy.data.meshes.new(nom)
    me.from_pydata([vers_blender(Vector(v))[:] for v in verts], [], [tuple(int(i) for i in f) for f in faces])
    me.uv_layers.new(name="UVMap")
    if rangees_faces is not None:
        regler_uv(me, rangees_faces)
    me.shade_smooth() if hasattr(me, "shade_smooth") else me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.update()
    return me


def decimer(me, cible):
    """Copie du maillage réduite à environ `cible` triangles (Decimate, réduction d'arêtes)."""
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if tris <= cible:
        return me.copy()
    ob = bpy.data.objects.new("_decim", me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = cible / tris
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    nouveau = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    return nouveau


def sommets_faces(me):
    """Sommets (repère cycliste) et faces d'un maillage Blender."""
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3) * np.array([-1.0, -1.0, 1.0])
    return co, [list(p.vertices) for p in me.polygons]


def regler_uv(me, rangees_faces):
    uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name="UVMap")
    coords = []
    for p, r in zip(me.polygons, rangees_faces):
        coords.extend(uv_rangee(int(r)) * p.loop_total)
    uv.data.foreach_set("uv", coords)


RANGEE_PARTIE = {"tete": "tete", "cou": "tronc", "torse": "tronc", "hanches": "tronc", "fessier": "tronc", "epaule": "bras",
                 "bras": "bras", "avantbras": "avantbras", "main": "main", "cuisse": "cuisse", "jambe": "jambe", "genou": "jambe",
                 "pied": "jambe"}


def axes_rangees(J):
    """Axe de chaque rangée (et de chaque côté) : position 0 → 1 le long du membre, dans la pose de référence."""
    ax = {("tronc", None): (J["bassin"], J["cou"], 1 / TRONC_MAX)}
    for nom, _ in COTES:
        ax[("bras", nom)] = (J[nom + "Epaule"], J[nom + "Coude"], 1.0)
        ax[("avantbras", nom)] = (J[nom + "Coude"], J[nom + "Poignet"], 1.0)
        ax[("main", nom)] = (J[nom + "Poignet"], J[nom + "Doigts"], 1.0)
        ax[("cuisse", nom)] = (J[nom + "Hanche"], J[nom + "Genou"], 1.0)
        ax[("jambe", nom)] = (J[nom + "Genou"], J[nom + "Cheville"], 1.0)
    return ax


def uv_corps(me, prims, J):
    """UV du corps : rangée de la primitive la plus proche du centre de chaque face ; en largeur, la position de chaque
    sommet le long de l'axe de cette rangée (limites de tenue nettes, indépendantes du maillage)."""
    co, faces = sommets_faces(me)
    centres = np.array([co[f].mean(0) for f in faces])
    meilleur = np.stack([p["f"](centres) for p in prims], 1).argmin(1)
    T = {}
    for cle, (a, b, k) in axes_rangees(J).items():
        a, b = _np(a), _np(b)
        ab = b - a
        T[cle] = np.clip(((co - a) @ ab) / (ab @ ab) * k, 0.0, 1.0)
    coords = []
    for f, i in zip(faces, meilleur):
        pr = prims[i]
        rang = RANGEE_PARTIE[pr["partie"]]
        if rang == "tete":
            coords.extend(uv_rangee(R["tete"]) * len(f))
            continue
        cote = None if rang == "tronc" else ("Left" if pr["os"].startswith("Left") else "Right")
        t = T[(rang, cote)]
        for v in f:
            coords.extend(uv_rangee(R[rang], t[v]))
    me.uv_layers[0].data.foreach_set("uv", coords)


def distances(prims, X):
    return np.stack([p["f"](X) for p in prims], 1)


def poids_os(prims, D):
    """Poids des os par sommet : influence de chaque primitive (décroissance de sa distance), regroupée par os, 4 os au plus."""
    Wb = np.zeros((D.shape[0], len(NOMS_OS)))
    for i, p in enumerate(prims):
        d = D[:, i]
        Wb[:, IO[p["os"]]] += np.exp(-np.maximum(0, d) / 0.018) * (d < 0.06)
    ordre = np.argsort(-Wb, 1)[:, :4]
    garde = np.zeros_like(Wb)
    rows = np.arange(len(Wb))[:, None]
    garde[rows, ordre] = Wb[rows, ordre]
    s = garde.sum(1, keepdims=True)
    garde = np.where(s > 0, garde / np.maximum(s, 1e-12), 0)
    garde[s[:, 0] == 0, IO["Hips"]] = 1
    return garde


# ---------------------------------------------------------------------------------------------------
# Construction

def calculer_velo(p, M):
    """Paramètres du vélo, hauteur de selle ajustée aux jambes du cycliste, ancres (repère cycliste)."""
    pv = json.loads(json.dumps(VR.PARAMETRES))
    pv.update(p["velo"])
    reglee = "hauteur_selle" in p["velo"]
    if not reglee:  # genou à 145° en bas du coup de pédale
        cible = math.sqrt(M["cuisse"] ** 2 + M["jambe"] ** 2 - 2 * M["cuisse"] * M["jambe"] * math.cos(math.radians(145)))
        lo, hi = 0.5, 0.95
        for _ in range(30):
            pv["hauteur_selle"] = (lo + hi) / 2
            A = ancres_velo(pv)
            P = plan_position(A, M, "hoods", False)
            J, _ = articulations(P, math.pi / 2, A, M)
            if (J["RightCheville"] - J["RightHanche"]).length > cible:
                hi = pv["hauteur_selle"]
            else:
                lo = pv["hauteur_selle"]
        pv["hauteur_selle"] = round((lo + hi) / 2, 4)
    return pv, ancres_velo(pv)


def ancres_velo(pv):
    g = VR.calculer_geometrie(pv)
    _, ancres, piv, _ = VR.construire(pv, g, VR.QUALITE[2])
    A = {nom: pos for nom, (_, pos) in ancres.items()}
    A.update({"bb": g["bb"], "cintre": g["cintre"], "manivelle": pv["manivelle"], "g": g})
    return A


def construire_cycliste(p, dossier):
    sexe = p["sexe"]
    M = morphologie(sexe, p["taille_cycliste"])
    nom = p["nom"] or ("Cycliste_F" if sexe == "f" else "Cycliste_M")
    pv, A = calculer_velo(p, M)

    scene = bpy.context.scene
    scene.render.fps = IMAGES_PAR_TOUR
    col = bpy.data.collections.new(nom)
    scene.collection.children.link(col)
    images = creer_palette(nom, p, dossier)
    mat = VR.creer_materiau(nom, images)

    # pose de référence : sur les cocottes, les deux pieds au milieu du pédalier (pose symétrique)
    P0 = plan_position(A, M, "hoods", False)
    J0, plans0 = articulations(P0, 0.0, A, M)
    for nom_c, s in COTES:  # pieds ramenés au centre du pédalier : jambes symétriques
        ped = A["bb"] + LAT * (0.11 * s)
        incl = 0.0
        ch = ped + tourner(Vector((0.0, -0.06, 0.075)) * M["k"], LAT, incl)
        J0[nom_c + "Cheville"], J0[nom_c + "Pointe"] = ch, ped + Vector((0.0, 0.10, 0.03)) * M["k"]
        J0[nom_c + "Genou"], plans0[nom_c + "Jambe"] = ik(J0[nom_c + "Hanche"], ch, M["cuisse"], M["jambe"],
                                                          Vector((s * 0.1, 1.0, 0.25)).normalized())
    J0["RightCheville"].x, J0["LeftCheville"].x = abs(J0["RightCheville"].x), -abs(J0["LeftCheville"].x)
    E0 = extremites_os(J0, plans0)
    prims = prims_corps(J0, M)
    # ancre des yeux (origine de la caméra du joueur dans le casque) : entre les yeux. C'est un petit os, enfant du buste,
    # pour qu'il garde sa place quand on réduit la tête du joueur à rien (il ne voit pas l'intérieur de sa tête).
    face = devant_visage(prims, J0["tete"], 0.012 * M["tete"])
    oeil = J0["tete"] + HAUT * (0.012 * M["tete"]) + AV * (face - 0.012)

    # squelette
    arm_data = bpy.data.armatures.new(nom + "_Squelette")
    arm = bpy.data.objects.new(nom, arm_data)
    col.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for o, parent in OS:
        tete, queue, xs = E0[o]
        m = repere_os(tete, queue, xs)
        eb = arm_data.edit_bones.new(o)
        eb.head = m.translation
        eb.tail = m.translation + m.col[1].to_3d() * (queue - tete).length
        eb.align_roll(m.col[2].to_3d())
        if parent:
            eb.parent = arm_data.edit_bones[parent]
        eb.use_connect = False
    eb = arm_data.edit_bones.new("Ancre_Yeux")
    eb.head, eb.tail = vers_blender(oeil), vers_blender(oeil + AV * 0.04)
    eb.align_roll(vers_blender(HAUT))
    eb.parent, eb.use_connect = arm_data.edit_bones["Spine"], False
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.show_in_front = True

    # corps
    tous = np.array([[v.x, v.y, v.z] for cle, v in J0.items() if cle != "lat"])
    mini, maxi = (tous.min(0) - 0.16).tolist(), (tous.max(0) + 0.16).tolist()
    pos, quads = surface_nets(lambda X: champ(prims, X), mini, maxi, 0.0105 * M["k"])
    me0 = maillage_blender(nom + "_corps_brut", pos, quads)
    cibles = {0: 14000, 1: 4500, 2: 1400}
    par_lod = {lod: [] for lod in p["lods"]}
    triangles = {}
    for lod in p["lods"]:
        me = decimer(me0, cibles[lod])
        me.name = f"Corps_LOD{lod}"
        co, faces = sommets_faces(me)
        uv_corps(me, prims, J0)
        Wv = poids_os(prims, distances(prims, co))
        me.materials.clear()
        me.materials.append(mat)
        ob = bpy.data.objects.new(f"Corps_LOD{lod}", me)
        col.objects.link(ob)
        ob.parent = arm
        for o in NOMS_OS:
            ob.vertex_groups.new(name=o)
        for b, o in enumerate(NOMS_OS):
            idx = np.nonzero(Wv[:, b] > 1e-4)[0]
            vg = ob.vertex_groups[o]
            for i in idx:
                vg.add([int(i)], float(Wv[i, b]), "REPLACE")
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
        par_lod[lod].append(ob)
        triangles.setdefault(f"LOD{lod}", {})[ob.name] = sum(len(f) - 2 for f in faces)
    bpy.data.meshes.remove(me0)

    # équipements
    bpy.context.view_layer.update()
    cibles_eq = {"Casque": (2400, 900, 300), "Lunettes": (500, 200, None), "Yeux": (160, 60, None), "Chaussure": (900, 350, 120),
                 "Cheveux": (400, 150, 60)}
    for nom_eq, (os_, pieces) in prims_equipements(J0, M, prims).items():
        verts, faces, cfaces = [], [], []
        for piece in pieces:
            base = len(verts)
            if piece[0] == "tube":
                mm = VR.Maillage()
                mm.tube(VR.catmull_rom(piece[1], 4), piece[2], 6, 0, ref=HAUT, transport=True)
                v_, f_ = [tuple(x) for x in mm.v], mm.f
                cell = R[piece[3]]
            elif piece[0] == "coque":
                v_, f_ = piece[1]
                cell = R[piece[2]]
            elif piece[0] == "sphere":
                (c0, r0), cell = piece[1], R[piece[2]]
                mm = VR.Maillage()
                mm.tour([(max(1e-4, r0 * math.sin(math.pi * i / 8)), r0 * math.cos(math.pi * i / 8)) for i in range(9)], 12, 0, c0,
                        axe=AV, e1=LAT)
                v_, f_ = [tuple(x) for x in mm.v], mm.f
            else:
                f, case, h = piece
                b = boite_serree(f, mini, maxi)
                if b is None:
                    continue
                v_, f_ = surface_nets(f, b[0], b[1], h * M["k"])
                v_ = [tuple(x) for x in v_]
                f_ = [tuple(int(i) for i in q) for q in f_]
                cell = R[case]
            verts.extend(tuple(x) for x in v_)
            faces.extend(tuple(i + base for i in f) for f in f_)
            cfaces.extend([cell] * len(f_))
        me_eq = maillage_blender(nom_eq + "_brut", verts, faces, cfaces)
        famille = next(k for k in cibles_eq if nom_eq.startswith(k))
        for lod in p["lods"]:
            cible = cibles_eq[famille][lod]
            if cible is None:
                continue
            me = decimer(me_eq, cible)
            # cases d'origine : recalculées au plus proche (la réduction mélange les UV aux frontières)
            regler_uv(me, cases_proches(me, me_eq, cfaces))
            me.materials.clear()
            me.materials.append(mat)
            ob = bpy.data.objects.new(f"{nom_eq}_LOD{lod}", me)
            col.objects.link(ob)
            # déformé à 100 % par son os (plus sûr qu'une parenté à un os, que les formats d'échange interprètent mal)
            ob.parent = arm
            ob.vertex_groups.new(name=os_).add(list(range(len(me.vertices))), 1.0, "REPLACE")
            ob.modifiers.new("Armature", "ARMATURE").object = arm
            visible = equipement_visible(nom_eq, p)
            ob.hide_set(not visible)
            ob.hide_render = not visible
            par_lod[lod].append(ob)
            triangles.setdefault(f"LOD{lod}", {})[ob.name] = sum(len(f.vertices) - 2 for f in me.polygons)
        bpy.data.meshes.remove(me_eq)

    for lod in triangles:
        triangles[lod]["total_visible"] = sum(n for o, n in triangles[lod].items() if equipement_visible(o.rsplit("_LOD", 1)[0], p))
    animer(arm, A, M)
    return {"nom": nom, "arm": arm, "col": col, "par_lod": par_lod, "triangles": triangles, "velo": pv, "M": M, "A": A,
            "images": images, "J0": J0}


def cases_proches(me, me_ref, cfaces):
    """Case de chaque face d'un maillage réduit : celle de la face la plus proche du maillage d'origine."""
    ref_c = np.array([p.center[:] for p in me_ref.polygons])
    cref = np.array(cfaces)
    out = []
    for p in me.polygons:
        out.append(cref[np.argmin(((ref_c - np.array(p.center[:])) ** 2).sum(1))])
    return out


def equipement_visible(nom_eq, p):
    if nom_eq.startswith("Corps") or nom_eq in ("Yeux", "Cheveux"):
        return True
    if nom_eq.startswith("Casque_"):
        return nom_eq == "Casque_" + p["casque"]
    if nom_eq.startswith("Lunettes_"):
        return p["casque"] != "tt" and nom_eq == "Lunettes_" + p["lunettes"]
    if nom_eq.startswith("Chaussure"):
        return nom_eq.endswith("_" + p["chaussures"])
    return True


# ---------------------------------------------------------------------------------------------------
# Animations

def poses_monde(P, theta, A, M, debout):
    J, plans = articulations(P, theta, A, M, debout)
    E = extremites_os(J, plans)
    return {o: repere_os(*E[o]) for o in NOMS_OS}


def animer(arm, A, M):
    """Un clip par position : un tour de pédalier en IMAGES_PAR_TOUR + 1 clés (la dernière = la première)."""
    ad = arm.animation_data_create()
    os_rest = {b.name: b.matrix_local.copy() for b in arm.data.bones}
    for clip, pos, debout in CLIPS:
        act = bpy.data.actions.new(clip)
        act.use_fake_user = True
        ad.action = act
        P = plan_position(A, M, pos, debout)
        precedent = {}
        for f in range(IMAGES_PAR_TOUR + 1):
            theta = 2 * math.pi * f / IMAGES_PAR_TOUR
            Mw = poses_monde(P, theta, A, M, debout)
            for o, parent in OS:
                pb = arm.pose.bones[o]
                if parent is None:
                    base = os_rest[o].inverted() @ Mw[o]
                else:
                    base = (Mw[parent] @ os_rest[parent].inverted() @ os_rest[o]).inverted() @ Mw[o]
                loc, rot, _ = base.decompose()
                if o in precedent and precedent[o].dot(rot) < 0:
                    rot.negate()
                precedent[o] = rot
                pb.rotation_mode = "QUATERNION"
                pb.location, pb.rotation_quaternion = loc, rot
                pb.keyframe_insert("location", frame=f, group=o)
                pb.keyframe_insert("rotation_quaternion", frame=f, group=o)
        piste = ad.nla_tracks.new()
        piste.name = clip
        bande = piste.strips.new(clip, 0, act)
        if hasattr(bande, "action_slot") and act.slots:
            bande.action_slot = act.slots[0]
        piste.mute = True
        ad.action = None
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 0, IMAGES_PAR_TOUR


def poser(arm, clip, image):
    """Montre le cycliste dans un clip, à une image donnée (aperçus)."""
    arm.animation_data.action = bpy.data.actions[clip] if clip else None
    bpy.context.scene.frame_set(image)


# ---------------------------------------------------------------------------------------------------
# Export, rapport, aperçus

def exporter(sc, p, dossier):
    nom, col = sc["nom"], sc["col"]
    for ob in col.objects:
        ob.hide_set(False)
        ob.hide_viewport = False
    layer_col = bpy.context.view_layer.layer_collection.children[col.name]
    bpy.context.view_layer.active_layer_collection = layer_col
    fichiers = []
    if "fbx" in p["formats"]:
        chemin = os.path.join(dossier, nom + ".fbx")
        bpy.ops.export_scene.fbx(filepath=chemin, use_active_collection=True, object_types={"ARMATURE", "EMPTY", "MESH"},
                                 apply_unit_scale=True, apply_scale_options="FBX_SCALE_ALL", axis_forward="-Z", axis_up="Y",
                                 bake_space_transform=False, mesh_smooth_type="OFF", use_tspace=False, add_leaf_bones=False,
                                 primary_bone_axis="Y", secondary_bone_axis="X", armature_nodetype="NULL",
                                 path_mode="STRIP", embed_textures=False, bake_anim=True, bake_anim_use_all_bones=True,
                                 bake_anim_use_nla_strips=False, bake_anim_use_all_actions=True, bake_anim_force_startend_keying=True,
                                 bake_anim_step=1.0, bake_anim_simplify_factor=0.0)
        fichiers.append(chemin)
    if "glb" in p["formats"]:
        chemin = os.path.join(dossier, nom + ".glb")
        bpy.ops.export_scene.gltf(filepath=chemin, export_format="GLB", use_active_collection=True, export_yup=True,
                                  export_apply=False, export_cameras=False, export_extras=False, export_animations=True,
                                  export_animation_mode="ACTIONS", export_force_sampling=True, export_skins=True)
        fichiers.append(chemin)
    if "blend" in p["formats"]:
        chemin = os.path.join(dossier, nom + ".blend")
        bpy.ops.wm.save_as_mainfile(filepath=chemin, copy=True, relative_remap=True)
        fichiers.append(chemin)
    for ob in col.objects:
        if ob.type == "MESH" and not ob.name.startswith("Corps"):
            visible = equipement_visible(ob.name.rsplit("_LOD", 1)[0], p)
            ob.hide_set(not visible)
            ob.hide_render = not visible
    return fichiers


def rapport(sc, p, fichiers, dossier):
    r = {
        "nom": sc["nom"],
        "parametres": {k: v for k, v in p.items() if k not in ("liste",)},
        "velo": {"parametres": sc["velo"], "hauteur_selle": sc["velo"]["hauteur_selle"]},
        "morphologie": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in sc["M"].items()},
        "os": [{"nom": o, "parent": par} for o, par in OS],
        "clips": [{"nom": c, "position": pos, "danseuse": d, "images": IMAGES_PAR_TOUR + 1, "images_par_seconde": IMAGES_PAR_TOUR}
                  for c, pos, d in CLIPS],
        "rangees": RANGEES,
        "triangles": sc["triangles"],
        "ancre_yeux_unity": vers_unity(sc["arm"].data.bones["Ancre_Yeux"].head_local),
        "fichiers": [os.path.basename(f) for f in fichiers],
    }
    with open(os.path.join(dossier, sc["nom"] + ".rapport.json"), "w", encoding="utf-8") as fh:
        json.dump(r, fh, ensure_ascii=False, indent=2)
    return r


def rendre_apercus(sc, p, dossier):
    import numpy as np_

    nom, arm, par_lod = sc["nom"], sc["arm"], sc["par_lod"]
    pv = sc["velo"]
    sv = VR.construire_scene(dict(pv, lods=[0], nom="Velo_apercu"), dossier, reinitialiser=False)
    velo_obs = sv["par_lod"][0]
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 40
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
    soleil.data.energy, soleil.data.angle = 3.2, math.radians(6)
    soleil.rotation_euler = (math.radians(42), 0.0, math.radians(-125))
    scene.collection.objects.link(soleil)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    scene.collection.objects.link(cam)
    scene.camera = cam

    def viser(pos, cible, lentille=50, ortho=None):
        cam.data.type = "ORTHO" if ortho else "PERSP"
        if ortho:
            cam.data.ortho_scale = ortho
        cam.data.lens = lentille
        cam.location = pos
        cam.rotation_euler = (Vector(cible) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()

    def montrer(lod):
        for l, obs in par_lod.items():
            for ob in obs:
                visible = equipement_visible(ob.name.rsplit("_LOD", 1)[0], p)
                ob.hide_render = (l != lod) or not visible

    def rendre(fichier, lx, ly, fmt="JPEG"):
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = lx, ly, 100
        scene.render.image_settings.file_format = fmt
        if fmt == "JPEG":
            scene.render.image_settings.quality = 88
        scene.render.filepath = os.path.join(dossier, fichier)
        bpy.ops.render.render(write_still=True)
        return scene.render.filepath

    def planche(fichier, vues, lx, ly):
        imgs = []
        for k, prepare in enumerate(vues):
            prepare()
            chemin = rendre(f"_vue{k}.png", lx, ly, "PNG")
            im = bpy.data.images.load(chemin)
            px = np_.empty(im.size[0] * im.size[1] * 4, dtype=np_.float32)
            im.pixels.foreach_get(px)
            imgs.append(px.reshape(im.size[1], im.size[0], 4))
            bpy.data.images.remove(im)
            os.remove(chemin)
        tout = np_.concatenate(imgs, axis=1)
        sortie = bpy.data.images.new(fichier, tout.shape[1], tout.shape[0], alpha=True)
        sortie.pixels.foreach_set(tout.ravel())
        sortie.filepath_raw = os.path.join(dossier, fichier)
        sortie.file_format = "JPEG"
        try:
            sortie.save(quality=88)
        except TypeError:
            sortie.save()

    montrer(0)
    tq = ((-2.6, -2.2, 1.6), (0.0, -0.05, 0.92))
    poser(arm, "Pedalage_hoods", 3)
    viser(*tq)
    rendre(f"{nom}_apercu.jpg", 1200, 800)

    def vue_profil(clip, image):
        def f():
            poser(arm, clip, image)
            viser((-4.0, 0.0, 0.86), (0.0, 0.0, 0.86), ortho=2.25)
        return f
    scene.cycles.samples = 24
    planche(f"{nom}_apercu_positions.jpg", [vue_profil("Pedalage_tops", 0), vue_profil("Pedalage_hoods", 9),
                                            vue_profil("Pedalage_drops", 18), vue_profil("Danseuse_hoods", 4)], 560, 480)
    # un tour de pédalier (les pieds suivent les pédales)
    pedalier = bpy.data.objects["Pivot_Pedalier"]
    pedales = [bpy.data.objects["Pivot_PedaleD"], bpy.data.objects["Pivot_PedaleG"]]

    def vue_tour(image):
        def f():
            poser(arm, "Pedalage_hoods", image)
            ang = 2 * math.pi * image / IMAGES_PAR_TOUR
            pedalier.rotation_euler = (ang, 0.0, 0.0)
            for pe in pedales:
                pe.rotation_euler = (-ang, 0.0, 0.0)
            viser((-2.4, 0.15, 0.45), (0.0, 0.15, 0.45), ortho=1.2)
        return f
    planche(f"{nom}_apercu_pedalage.jpg", [vue_tour(i) for i in (0, 9, 18, 27)], 420, 420)
    pedalier.rotation_euler = (0.0, 0.0, 0.0)
    for pe in pedales:
        pe.rotation_euler = (0.0, 0.0, 0.0)

    # équipements : casques et lunettes (gros plan), puis tenues
    tete = vers_blender(sc["J0"]["tete"])
    combos = [("road", "sport"), ("city", "none"), ("aero", "shield"), ("tt", "none")]

    def vue_casque(casque, lunettes):
        def f():
            q = dict(p, casque=casque, lunettes=lunettes)
            for obs in par_lod.values():
                for ob in obs:
                    ob.hide_render = not (ob.name.endswith("_LOD0") and equipement_visible(ob.name.rsplit("_LOD", 1)[0], q))
            poser(arm, "Pedalage_hoods", 0)
            viser((tete.x - 0.55, tete.y - 0.55, tete.z + 0.12), (tete.x, tete.y, tete.z - 0.02), 60)
        return f
    planche(f"{nom}_apercu_casques.jpg", [vue_casque(*c) for c in combos], 420, 420)

    tenues = [dict(tenue="fitted", chaussettes="classic", chaussures="road"),
              dict(tenue="skinsuit_tt", chaussettes="aero", chaussures="aero", maillot="#1F4E9C", maillot_accent="#F2C230"),
              dict(tenue="loose", chaussettes="short", chaussures="flat", maillot="#3E5F4A", motif="uni"),
              dict(tenue="skinsuit", chaussettes="aero", chaussures="carbon", maillot="#111111", maillot_accent="#E0B000")]

    def vue_tenue(t):
        def f():
            q = dict(p, **t)
            ecrire_palette(sc["images"], q)
            for obs in par_lod.values():
                for ob in obs:
                    ob.hide_render = not (ob.name.endswith("_LOD0") and equipement_visible(ob.name.rsplit("_LOD", 1)[0], q))
            poser(arm, "Pedalage_hoods", 3)
            viser(*tq)
        return f
    planche(f"{nom}_apercu_tenues.jpg", [vue_tenue(t) for t in tenues], 600, 400)
    ecrire_palette(sc["images"], p)
    montrer(0)

    # niveaux de détail, et vue du joueur dans le casque (sans sa tête)
    def vue_lod(lod):
        def f():
            montrer(lod)
            poser(arm, "Pedalage_hoods", 3)
            viser(*tq)
        return f
    planche(f"{nom}_apercu_lod.jpg", [vue_lod(lod) for lod in sorted(par_lod)], 600, 400)
    montrer(0)
    for obs in par_lod.values():
        for ob in obs:
            if "Head" in ob.vertex_groups and not ob.name.startswith("Corps"):
                ob.hide_render = True
    for ob in sc["par_lod"][0]:
        if ob.name.startswith("Corps"):
            ob.hide_render = False
    poser(arm, "Pedalage_hoods", 3)
    bpy.context.view_layer.update()
    yeux = arm.matrix_world @ arm.pose.bones["Ancre_Yeux"].head
    arm.pose.bones["Head"].scale = (0.01, 0.01, 0.01)   # le joueur ne voit pas l'intérieur de sa tête (même astuce dans Unity)
    cible = vers_blender(sc["A"]["cintre"] + AV * 0.6 + HAUT * (-0.75))
    viser(yeux + (yeux - cible).normalized() * 0.02, cible, 16)
    scene.cycles.samples = 40
    rendre(f"{nom}_apercu_joueur.jpg", 1000, 640)
    arm.pose.bones["Head"].scale = (1.0, 1.0, 1.0)
    montrer(0)
    for ob in velo_obs:
        ob.hide_render = False
    print("  aperçus :", ", ".join(f"{nom}_apercu{s}.jpg" for s in ("", "_positions", "_pedalage", "_casques", "_tenues", "_lod", "_joueur")))


# ---------------------------------------------------------------------------------------------------
# Ligne de commande

def lire_parametres(argv):
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    ap = argparse.ArgumentParser(prog="cycliste.py", add_help=False,
                                 description="Cycliste pour Unity : corps, tenues, équipements et animations, construits par Blender.")
    ap.add_argument("--aide", "-h", "--help", action="help", help="affiche cette aide")
    ap.add_argument("--config", help="fichier JSON de paramètres (les clés de PARAMETRES)")
    ap.add_argument("--sexe", choices=["m", "f"])
    ap.add_argument("--taille-cycliste", type=float, dest="taille_cycliste", help="taille du cycliste (m)")
    ap.add_argument("--tenue", choices=TENUES)
    ap.add_argument("--chaussettes", choices=CHAUSSETTES)
    ap.add_argument("--casque", choices=CASQUES)
    ap.add_argument("--lunettes", choices=LUNETTES)
    ap.add_argument("--chaussures", choices=CHAUSSURES)
    ap.add_argument("--maillot", help="couleur du maillot, #RRVVBB")
    ap.add_argument("--maillot-accent", dest="maillot_accent", help="couleur d'accent du maillot")
    ap.add_argument("--cuissard", help="couleur du cuissard")
    ap.add_argument("--peau", help="couleur de la peau")
    ap.add_argument("--motif", choices=["uni", "bande"])
    ap.add_argument("--cadre", choices=list(VR.CADRES), help="cadre du vélo (velo_route.py)")
    ap.add_argument("--taille", type=float, help="taille du cadre (cm)")
    ap.add_argument("--velo-config", dest="velo_config", help="fichier JSON des paramètres du vélo (velo_route.py)")
    ap.add_argument("--avec-velo", action="store_true", default=None, dest="avec_velo", help="exporte aussi le vélo correspondant")
    ap.add_argument("--nom")
    ap.add_argument("--sortie")
    ap.add_argument("--formats", help="liste : fbx,glb,blend")
    ap.add_argument("--lods", help="niveaux de détail, par exemple 0,1,2")
    ap.add_argument("--apercu", action="store_true", default=None, help="rendus JPEG de contrôle (Cycles)")
    ap.add_argument("--liste", action="store_true", help="affiche le catalogue et quitte")
    a = ap.parse_args(argv)
    p = json.loads(json.dumps(PARAMETRES))
    if a.config:
        with open(a.config, encoding="utf-8") as fh:
            conf = json.load(fh)
        inconnues = set(conf) - set(PARAMETRES)
        if inconnues:
            raise SystemExit(f"clés inconnues dans {a.config} : {', '.join(sorted(inconnues))}")
        p.update(conf)
    if a.velo_config:
        with open(a.velo_config, encoding="utf-8") as fh:
            p["velo"].update(json.load(fh))
    if a.cadre:
        p["velo"]["cadre"] = a.cadre
    if a.taille:
        p["velo"]["taille_cm"] = a.taille
    for cle, val in vars(a).items():
        if cle in PARAMETRES and val is not None and cle != "velo":
            p[cle] = val
    if isinstance(p["formats"], str):
        p["formats"] = [f.strip().lower() for f in p["formats"].split(",") if f.strip()]
    if isinstance(p["lods"], str):
        p["lods"] = [int(x) for x in p["lods"].split(",") if x.strip()]
    if any(l not in (0, 1, 2) for l in p["lods"]):
        raise SystemExit("niveaux de détail possibles : 0, 1, 2")
    for cle, choix in (("tenue", TENUES), ("chaussettes", CHAUSSETTES), ("casque", CASQUES), ("lunettes", LUNETTES),
                       ("chaussures", CHAUSSURES)):
        if p[cle] not in choix:
            raise SystemExit(f"{cle} inconnu : {p[cle]} (choix : {', '.join(choix)})")
    for cle in ("peau", "cheveux", "maillot", "maillot_accent", "cuissard", "gants", "couleur_chaussettes", "couleur_casque",
                "couleur_chaussures"):
        VR.hex_srgb(p[cle])
    p["liste"] = a.liste
    return p


def main():
    p = lire_parametres(sys.argv)
    if p["liste"]:
        for titre, liste in (("tenues", TENUES), ("chaussettes", CHAUSSETTES), ("casques", CASQUES), ("lunettes", LUNETTES),
                             ("chaussures", CHAUSSURES), ("positions", list(POSITIONS)), ("clips", [c for c, _, _ in CLIPS])):
            print(f"{titre:12s}:", ", ".join(liste))
        return
    dossier = os.path.abspath(p["sortie"])
    os.makedirs(dossier, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = construire_cycliste(p, dossier)
    fichiers = exporter(sc, p, dossier)
    r = rapport(sc, p, fichiers, dossier)
    print(f"{sc['nom']} : selle à {sc['velo']['hauteur_selle']} m ; "
          + ", ".join(f"{k} {v['total_visible']} triangles visibles" for k, v in r["triangles"].items()))
    for f in fichiers:
        print("  →", f)
    if p["apercu"]:
        rendre_apercus(sc, p, dossier)
    if p["avec_velo"]:
        # le vélo réglé pour ce cycliste (hauteur de selle) : Velo_Aero_M, Velo_Aero_F…
        suffixe = sc["nom"].replace("Cycliste_", "")
        pv = dict(sc["velo"], sortie=p["sortie"], formats=[f for f in p["formats"] if f in ("glb", "fbx", "blend")], apercu=False,
                  nom=f"Velo_{sc['velo']['cadre'].capitalize()}_{suffixe}")
        VR.generer(pv)


if __name__ == "__main__":
    main()
