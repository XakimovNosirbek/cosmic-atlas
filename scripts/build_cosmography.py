#!/usr/bin/env python
"""Cosmography of the local universe: CF4++ density + flow, Laniakea basins, 2MRS galaxy groups.

SOURCES (all downloads cached in data/cache/, each in its own directory)
  1. CF4++ HMC mean/std grids (Courtois, Mould, Hollinger, Dupuy & Zhang 2025, A&A 701, A187, doi:10.1051/0004-6361/202553677;
     arXiv:2502.01308), https://projets.ip2i.in2p3.fr//cosmicflows/new_CF4pp_mean_std_grids.npz.
     The provider's erratum: vr_mean was wrong before 2026-10-13; only the file served with
     Last-Modified 2026-10-13 08:38:44 GMT (ETag "6acdee14-a0006be", 167,773,886 B) is accepted.
     Arrays d_mean, d_std (density contrast delta), v_mean, v_std (3 x 128^3, km/s), indexed
     [SGX, SGY, SGZ] (checked: v_mean . r_hat reproduces vr_mean to 1e-9 km/s only in this order),
     box L = 1000 h^-1 Mpc centred on us, cell i spans -500 + [i, i+1) * 7.8125 h^-1 Mpc
     (provider script retrieve_CF4pp_grid_values.py, to_grid_index).
  2. CF4 watersheds (Dupuy & Courtois 2023, A&A 678, A176; arXiv:2305.02339),
     CF4_new_128-z008_watersheds-fits.zip: CF4_new_128-z008_BoA.fits = basins of attraction of the
     ungrouped CF4 velocity field, 128^3 labels 0..9 in the order of their Table 1 (1 Laniakea,
     2 Apus, 3 Hercules, 4 Lepus, 5 Perseus-Pisces, 6 Shapley, 7 SDSS-1a, 8 SDSS-2a, 9 SDSS-2b).
     The FITS array is [SGZ, SGY, SGX]: of all 48 axis permutations / flips only this one puts each
     of the 9 published attractors inside its own basin, and it gives the published volumes
     (Laniakea 4079 voxels = 1.95e6 (h^-1 Mpc)^3, Table 1: 1.9).
     NOTE: the basins come from the CF4 (2023) field, the density and flow from CF4++ (2025).
  3. 2MRS groups (Tully 2015, AJ 149, 171), VizieR J/AJ/149/171/table5 from the CfA mirror
     (vizier.cfa.harvard.edu; CDS Strasbourg was down): every 2MRS galaxy with its nest.
  4. Cluster positions for names: SIMBAD (CfA mirror), see CLUSTERS.

DISTANCE SCALE (the one conversion, also in meta.json and the viewer)
  The CF4 grids are in h^-1 Mpc: lengths times h = H0 / 100. The reconstruction started from
  H0 = 74.6 (Tully et al. 2023, CF4 nominal) and its HMC fit gives H0 = 75.0 +- 0.35 for the
  ungrouped CF4 (Courtois et al. 2023, A&A 670, L15); CF4++ uses the same method. Our DESI, 2MRS
  and SDSS layers place galaxies at the Planck18 comoving distance of their redshift
  (H0 = 67.66, h = 0.6766). Comoving distance in h^-1 Mpc is the same number in any flat LCDM at
  these redshifts (Omega_m 0.30 vs 0.31 changes it < 0.3 % at z = 0.1), so ONE length in h^-1 Mpc
  is drawn as L / 0.6766 Mpc: the structures sit where the Planck18 redshift layers put galaxies
  of the same Hubble-flow velocity. In CF4's own scale (H0 = 75) the same point is 0.902 times as
  far; the info card shows both. Nothing is drawn at the H0 = 75 scale.
  2MRS groups: Tully's <Vcmba> is a CMB-frame velocity "adjusted by a cosmological model"
  (Tully et al. 2013, CF2: V_mod = cz [1 + (1 - q0) z / 2 - (1 - q0 - 3 q0^2 + 1) z^2 / 6],
  Omega_m = 0.27, q0 = -0.595). We use instead the members median HELIOCENTRIC velocity, so a group
  sits on its member galaxies in the 2MRS layer (Planck18 comoving distance of heliocentric cz,
  scripts/fetch_local_universe.py). Masses and radii in h^-1 units are converted with h = 0.6766.

OUTPUT
  data/tiles/cosmography/meta.json, PROVENANCE.json   (tracked)
  data/tiles/cosmography/density_rg8.bin   128^3 RG8, x (SGX) fastest: R = delta code, G = std code
  data/tiles/cosmography/basins_u8.bin     128^3 uint8 basin label (0 = none), x fastest
  data/tiles/cosmography/streams.bin       float32 xyz (SG, h^-1 Mpc) per vertex, then per line
                                           uint32 first vertex, uint16 count, uint8 seed basin, uint8 end basin
  data/tiles/catalogs/cosmography.json     superclusters (basins), attractors, named clusters (tracked)
  data/tiles/catalogs/groups-2mrs.json     2MRS groups with >= 2 members and their members (tracked)
  data/tiles/catalogs/provenance/cosmography.json

Usage: .venv/bin/python -I scripts/build_cosmography.py [--cache data/cache] [--fig figures/laniakea-check.png]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from astropy.cosmology import Planck18
from scipy.ndimage import map_coordinates

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coords import C_KMS, comoving_pc  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
IP2I = "https://projets.ip2i.in2p3.fr//cosmicflows/"
NPZ = "new_CF4pp_mean_std_grids.npz"
NPZ_LAST_MODIFIED = "Tue, 13 Oct 2026 08:38:44 GMT"
NPZ_BYTES = 167773886
ZIP = "CF4_new_128-z008_watersheds-fits.zip"
BOA = "CF4_new_128-z008_BoA.fits"
VIZ = "https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?-source=J/AJ/149/171/table5&-out.all&-out.max=unlimited&-out.form=mini"

N = 128
L_BOX = 1000.0  # h^-1 Mpc
DL = L_BOX / N
H_P18 = float(Planck18.h)  # 0.6766
H_CF4 = 0.750  # Courtois et al. 2023: H0 = 75.0 +- 0.35 (ungrouped CF4)
PC_PER_UNIT = 1e6 / H_P18  # map pc per h^-1 Mpc

# Galactic -> supergalactic (astropy 8.0.2 Supergalactic; web/src/cosmography/sgframe.ts builds the same)
GAL_TO_SG = np.array([
    [-7.3574257480437488e-01, 6.7726129641389432e-01, -1.0591144540819700e-16],
    [-7.4553778365233705e-02, -8.0991471306976578e-02, 9.9392259039977493e-01],
    [6.7314530210920764e-01, 7.3127116581696450e-01, 1.1008126222478197e-01],
])

# density / std codes (linear)
D_LO, D_HI = -2.0, 3.5
S_LO, S_HI = 0.0, 1.0

# Dupuy & Courtois 2023, Table 1, CF4 galaxies (ungrouped): attractor RA, Dec (deg), V_CMB (km/s),
# SGX, SGY, SGZ (h^-1 Mpc), basin volume (1e6 (h^-1 Mpc)^3); label = row order
BASINS = [
    (1, "Laniakea", 263, -39, 7412, (-62, -8, 39), 1.9),
    (2, "Apus", 199, -75, 13096, (-125, -23, -31), 9.5),
    (3, "Hercules", 237, 9, 11213, (-39, 70, 78), 3.1),
    (4, "Lepus", 99, -49, 13189, (-62, -39, -109), 8.1),
    (5, "Perseus-Pisces", 56, 21, 6102, (47, -23, -31), 4.8),
    (6, "Shapley", 199, -40, 15468, (-141, 62, -16), 7.9),
    (7, "SDSS-1a", 133, 24, 34117, (117, 227, -227), 184.8),
    (8, "SDSS-2a", 209, 12, 32979, (-102, 297, 102), 169.8),
    (9, "SDSS-2b", 218, 36, 33007, (31, 289, 156), 130.2),
]
BASIN_ALT = {
    "Laniakea": ["Laniakea Supercluster", "Local Supercluster basin"],
    "Perseus-Pisces": ["Perseus–Pisces", "Perseus-Pisces Supercluster", "Perseus Pisces"],
    "Shapley": ["Shapley Supercluster", "Shapley Concentration"],
    "Hercules": ["Hercules Supercluster"], "Apus": ["Apus Supercluster"], "Lepus": ["Lepus Supercluster"],
}
REF_DC23 = "Dupuy & Courtois 2023, A&A 678, A176 (CF4 watersheds, Table 1)"
DOI_DC23 = "10.1051/0004-6361/202346802"
REF_CF4PP = "Courtois et al. 2025, A&A 701, A187 (CF4++ HMC grids; doi:10.1051/0004-6361/202553677)"

# Named clusters: SIMBAD (CfA mirror, queried 2026-11-14) ICRS centre and heliocentric cz, used only to
# find the 2MRS nest (largest Nmb within 1.5 deg and 900 km/s). Tully 2015 Table 2 names come first.
TULLY_T2 = {100001: "Coma Cluster", 100002: "Virgo Cluster", 100003: "Centaurus Cluster", 100004: "Abell 2199",
            100005: "Abell 1367", 100009: "Ophiuchus Cluster", 200001: "Perseus Cluster", 200002: "Norma Cluster",
            200016: "Abell 2634", 200017: "Abell 539"}
CLUSTERS = [  # name, alt, ra, dec, cz (SIMBAD), ref
    ("Fornax Cluster", ["Abell S373", "ACO S 373"], 54.6225, -35.4522, 1495, "2021A&A...652A..12K"),
    ("Hydra Cluster", ["Abell 1060", "Hydra I Cluster", "ACO 1060"], 159.15, -27.5178, 3842, "2022A&A...658A..59X"),
    ("Abell 3558", ["Shapley Supercluster core", "ACO 3558", "Shapley core"], 202.0133, -31.5264, 13874, "2022A&A...658A..59X"),
]
NAMED_ALT = {
    "Virgo Cluster": ["Virgo cluster of galaxies"],
    "Coma Cluster": ["Abell 1656", "ACO 1656"], "Perseus Cluster": ["Abell 426", "ACO 426"],
    "Norma Cluster": ["Abell 3627", "ACO 3627"], "Centaurus Cluster": ["Abell 3526", "ACO 3526"],
}
# Vela supercluster: hidden in the Zone of Avoidance, not a CF4 basin. Position from the literature.
VELA = {"l": 272.5, "b": 0.0, "d_h": 189.0, "radius_h": 70.0}


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sg_to_gal(v):
    return np.asarray(v, float) @ GAL_TO_SG  # row vectors: gal = sg @ M  (M orthonormal, gal = M^T sg)


def sg_unit(sgl, sgb):
    a, b = np.radians(sgl), np.radians(sgb)
    return np.stack([np.cos(b) * np.cos(a), np.cos(b) * np.sin(a), np.sin(b)], axis=-1)


def gal_to_radec(g):
    from astropy.coordinates import SkyCoord, CartesianRepresentation
    import astropy.units as u
    c = SkyCoord(CartesianRepresentation(*np.asarray(g, float).T * u.pc), frame="galactic").icrs
    return c.ra.deg, c.dec.deg


def map_pc(sg_h):
    """SG position in h^-1 Mpc -> contract frame pc (Planck18 scale, module docstring)."""
    return sg_to_gal(np.asarray(sg_h, float) * PC_PER_UNIT)


def r6(v):
    return [round(float(x), 0) for x in v]


def code(a, lo, hi):
    return np.clip(np.rint((a - lo) / (hi - lo) * 255), 0, 255).astype(np.uint8)


# ---------------------------------------------------------------------------- grids
def load_grids(cache: Path):
    p = cache / "cosmicflows" / NPZ
    if p.stat().st_size != NPZ_BYTES:
        raise SystemExit(f"{p}: {p.stat().st_size} B, expected {NPZ_BYTES} (post-erratum file of 2026-10-13)")
    d = np.load(p)
    grids = {k: d[k] for k in ("d_mean", "d_std", "v_mean", "v_std", "vr_mean")}
    # axis-order guard: v . r_hat must reproduce vr_mean (the erratum field) in [SGX, SGY, SGZ] order
    c = -L_BOX / 2 + (np.arange(N) + 0.5) * DL
    X, Y, Z = np.meshgrid(c, c, c, indexing="ij")
    r = np.sqrt(X ** 2 + Y ** 2 + Z ** 2)
    v = grids["v_mean"]
    rms = float(np.sqrt(np.mean(((v[0] * X + v[1] * Y + v[2] * Z) / r - grids["vr_mean"]) ** 2)))
    if rms > 1e-3:
        raise SystemExit(f"v_mean . r_hat differs from vr_mean by {rms} km/s rms: axis order or a pre-erratum file")
    from astropy.io import fits
    import zipfile
    with zipfile.ZipFile(cache / "cosmicflows" / ZIP) as z, z.open(BOA) as f:
        boa = fits.open(f)[0].data.astype(np.int16)  # [SGZ, SGY, SGX]
    labels = np.ascontiguousarray(boa.transpose(2, 1, 0))  # -> [SGX, SGY, SGZ]
    meta = {"npz_sha256": sha256(p), "zip_sha256": sha256(cache / "cosmicflows" / ZIP), "vr_check_rms_kms": rms,
            "hmc_steps": int(d["N"])}
    return grids, labels, meta


def idx_of(sg_h):
    """continuous voxel index (map_coordinates convention: voxel centre i at i)"""
    return (np.asarray(sg_h, float) + L_BOX / 2) / DL - 0.5


def label_at(labels, sg_h):
    i = np.clip(np.floor((np.asarray(sg_h, float) + L_BOX / 2) / DL).astype(int), 0, N - 1)
    return labels[i[..., 0], i[..., 1], i[..., 2]]


def streamlines(v, labels, seed_r=200.0, stride=3, step=0.5, max_steps=240, rng_seed=7):
    """forward streamlines of v_mean from a jittered sub-grid of seed voxels (r <= seed_r h^-1 Mpc)"""
    rng = np.random.default_rng(rng_seed)
    c = -L_BOX / 2 + (np.arange(N) + 0.5) * DL
    ii = np.arange(0, N, stride)
    S = np.stack(np.meshgrid(c[ii], c[ii], c[ii], indexing="ij"), -1).reshape(-1, 3)
    S = S + rng.uniform(-0.5, 0.5, S.shape) * DL * stride
    S = S[np.linalg.norm(S, axis=1) <= seed_r]
    pos = S.copy()
    paths = [pos.copy()]
    alive = np.ones(len(S), bool)
    stop = np.full(len(S), max_steps, int)
    converged = np.zeros(len(S), bool)

    def vel(p):
        q = idx_of(p).T
        return np.stack([map_coordinates(v[k], q, order=1, mode="nearest") for k in range(3)], -1)

    def dirn(p):
        w = vel(p)
        s = np.linalg.norm(w, axis=1, keepdims=True)
        return w / np.maximum(s, 1e-6), s[:, 0]

    h = step * DL
    for n in range(1, max_steps + 1):
        # RK4 on the unit direction field (arc-length parametrisation)
        k1, s1 = dirn(pos)
        k2, _ = dirn(pos + 0.5 * h * k1)
        k3, _ = dirn(pos + 0.5 * h * k2)
        k4, _ = dirn(pos + h * k3)
        new = pos + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
        new[~alive] = pos[~alive]
        pos = new
        paths.append(pos.copy())
        out = np.linalg.norm(pos, axis=1) > 420
        slow = s1 < 15.0
        conv = np.zeros(len(S), bool)
        if n >= 10:
            conv = np.linalg.norm(pos - paths[n - 10], axis=1) < 1.0 * DL
        end = alive & (out | slow | conv)
        stop[end] = n
        converged[end & (conv | slow) & ~out] = True
        alive &= ~end
        if not alive.any():
            break
    P = np.stack(paths, 1)  # (lines, steps+1, 3)
    return S, P, stop, converged


def attractors_from_ends(ends, labels):
    """cluster converged end points on a 2-voxel lattice; returns [(centre, count, label)] by count"""
    key = np.floor(ends / (2 * DL)).astype(int)
    df = pd.DataFrame({"kx": key[:, 0], "ky": key[:, 1], "kz": key[:, 2], "x": ends[:, 0], "y": ends[:, 1], "z": ends[:, 2]})
    g = df.groupby(["kx", "ky", "kz"]).agg(n=("x", "size"), x=("x", "mean"), y=("y", "mean"), z=("z", "mean")).reset_index()
    g = g.sort_values("n", ascending=False)
    out = []
    for r in g.itertuples():
        cxyz = np.array([r.x, r.y, r.z])
        out.append((cxyz, int(r.n), int(label_at(labels, cxyz))))
    return out


# ---------------------------------------------------------------------------- groups
def load_2mrs(cache: Path) -> pd.DataFrame:
    p = cache / "groups2mrs" / "table5.tsv"
    lines = [ln for ln in p.read_text().splitlines() if ln and not ln.startswith("#")]
    hdr = lines[0].split("\t")
    rows = [ln.split("\t") for ln in lines[3:]]
    df = pd.DataFrame(rows, columns=hdr)
    for c in df.columns:
        if c not in ("Simbad", "LEDA"):
            df[c] = pd.to_numeric(df[c].str.strip(), errors="coerce")
    return df


def pgc_names(cats: Path) -> dict[int, str]:
    out: dict[int, str] = {}
    doc = json.loads((cats / "galaxy-shapes.json").read_text())
    for g in doc["galaxies"]:
        if g.get("pgc"):
            out[int(g["pgc"])] = g["name"]
    return out


def build_groups(df: pd.DataFrame, names: dict[int, str]):
    g = df[df["Nest"] > 0].copy()
    agg = g.groupby("Nest").agg(n=("PGC", "size"), hv=("HV", "median"), pgc1=("PGC1", "first"), nmb=("Nmb", "first"),
                                 sgl=("GSGLON", "first"), sgb=("GSGLAT", "first"), logLK=("logLK", "first"),
                                 vcmba=("<Vcmba>", "first"), sigV=("sigV", "first"), sigP=("sigP", "first"),
                                 r2t=("R2t", "first"), mlum=("Mlum", "first"), mvir=("Mvir", "first"), cf=("CF", "first"))
    agg = agg[agg["n"] >= 2].reset_index()
    u = sg_unit(agg["sgl"].to_numpy(), agg["sgb"].to_numpy())
    d = comoving_pc(np.clip(agg["hv"].to_numpy(), 0, None) / C_KMS)
    xyz = sg_to_gal(u) * d[:, None]
    agg["x"], agg["y"], agg["z"], agg["dist_pc"] = xyz[:, 0], xyz[:, 1], xyz[:, 2], d
    # members, brightest (smallest Kmag) first
    mem = {}
    for nest, sub in g[g["Nest"].isin(agg["Nest"])].sort_values("Kmag").groupby("Nest"):
        mem[int(nest)] = [[int(p), names.get(int(p)), round(float(k), 2), int(hv)] for p, k, hv in zip(sub["PGC"], sub["Kmag"], sub["HV"])]
    return agg, mem


def match_named(agg: pd.DataFrame):
    from astropy.coordinates import SkyCoord
    import astropy.units as u
    named = {int(k): (v, NAMED_ALT.get(v, []), "Tully 2015, AJ 149, 171, Table 2") for k, v in TULLY_T2.items()}
    ra, dec = gal_to_radec(agg[["x", "y", "z"]].to_numpy())
    gc = SkyCoord(ra=ra * u.deg, dec=dec * u.deg)
    for name, alt, cra, cdec, cz, bib in CLUSTERS:
        sep = gc.separation(SkyCoord(ra=cra * u.deg, dec=cdec * u.deg)).deg
        ok = (sep < 1.5) & (np.abs(agg["hv"].to_numpy() - cz) < 900)
        if not ok.any():
            print(f"  no 2MRS nest for {name}")
            continue
        i = int(np.argmax(np.where(ok, agg["n"].to_numpy(), -1)))
        named[int(agg["Nest"].iloc[i])] = (name, alt, f"SIMBAD {bib} centre, matched to the 2MRS nest")
    return named


# ---------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", type=Path, default=ROOT / "data" / "cache")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "tiles" / "cosmography")
    ap.add_argument("--catalogs", type=Path, default=ROOT / "data" / "tiles" / "catalogs")
    ap.add_argument("--fig", type=Path, default=None)
    a = ap.parse_args()
    t0 = time.time()
    a.out.mkdir(parents=True, exist_ok=True)
    grids, labels, gmeta = load_grids(a.cache)
    dm, ds, v = grids["d_mean"], grids["d_std"], grids["v_mean"]

    # --- density + basin textures (x fastest: [SGX, SGY, SGZ] -> transpose to [SGZ, SGY, SGX] C order)
    rg = np.stack([code(dm, D_LO, D_HI), code(ds, S_LO, S_HI)], -1).transpose(2, 1, 0, 3)
    (a.out / "density_rg8.bin").write_bytes(np.ascontiguousarray(rg).tobytes())
    (a.out / "basins_u8.bin").write_bytes(np.ascontiguousarray(labels.transpose(2, 1, 0)).astype(np.uint8).tobytes())

    # --- streamlines
    S, P, stop, conv = streamlines(v, labels)
    seed_lab = label_at(labels, S)
    ends = P[np.arange(len(S)), stop]
    end_lab = label_at(labels, ends)
    keep = stop >= 4
    verts, first, count = [], [], []
    nv = 0
    for i in np.nonzero(keep)[0]:
        pts = P[i, : stop[i] + 1]
        pts = pts[::2] if len(pts) > 3 else pts  # one vertex per voxel length
        first.append(nv)
        count.append(len(pts))
        verts.append(pts)
        nv += len(pts)
    V = np.concatenate(verts).astype(np.float32)
    first = np.array(first, np.uint32)
    count = np.array(count, np.uint16)
    sl = seed_lab[keep].astype(np.uint8)
    el = end_lab[keep].astype(np.uint8)
    with (a.out / "streams.bin").open("wb") as f:
        f.write(V.tobytes()); f.write(first.tobytes()); f.write(count.tobytes()); f.write(sl.tobytes()); f.write(el.tobytes())

    # --- agreement of the CF4++ flow with the CF4 basins, attractors found by the flow
    agree = {}
    for lab, name, *_ in BASINS:
        m = (seed_lab == lab) & keep
        if m.sum():
            agree[name] = {"seeds": int(m.sum()), "end_in_same_basin": round(float((end_lab[m] == lab).mean()), 3),
                           "converged": round(float(conv[m].mean()), 3)}
    att = attractors_from_ends(ends[conv & keep], labels)
    found = []
    for lab, name, ra, dec, vcmb, sgp, vol in BASINS:
        cand = [t for t in att if t[2] == lab][:1]
        if cand:
            cxyz, n, _ = cand[0]
            found.append({"basin": name, "published_sg_h": list(sgp), "cf4pp_sink_sg_h": [round(float(x), 1) for x in cxyz],
                          "lines": n, "offset_h_mpc": round(float(np.linalg.norm(cxyz - np.array(sgp))), 1)})

    # --- catalogue: basins, attractors, Vela, named clusters
    entries = []
    cvox = -L_BOX / 2 + (np.arange(N) + 0.5) * DL
    vol_h = DL ** 3
    for lab, name, ra, dec, vcmb, sgp, vol in BASINS:
        ii = np.nonzero(labels == lab)
        cen = np.array([cvox[ii[0]].mean(), cvox[ii[1]].mean(), cvox[ii[2]].mean()])
        g = map_pc(cen)
        gra, gdec = gal_to_radec(g[None])
        vox = len(ii[0])
        att_pc = map_pc(sgp)
        e = {"name": name if not name.startswith("SDSS") else f"{name} basin", "alt": BASIN_ALT.get(name, []),
             "kind": "supercluster", "ra": round(float(gra[0]), 4), "dec": round(float(gdec[0]), 4),
             "dist_pc": round(float(np.linalg.norm(g)), -3), "xyz": r6(g), "docs": "laniakea", "basin": lab,
             "facts": {"basin_volume_mpc3": float(f"{vox * vol_h / H_P18 ** 3:.3g}"),
                       "attractor_vcmb_kms": vcmb,
                       "attractor_dist_mpc": round(float(np.linalg.norm(att_pc)) / 1e6, 1),
                       "attractor_dist_cf4_mpc": round(float(np.linalg.norm(sgp)) / H_CF4, 1),
                       "sg_attractor_hmpc": f"({sgp[0]}, {sgp[1]}, {sgp[2]})"},
             "facts_ref": {"basin_volume_mpc3": f"{REF_DC23}: {vol}e6 (h^-1 Mpc)^3; {vox} voxels of the published grid, h = 0.6766",
                           "attractor_vcmb_kms": REF_DC23, "attractor_dist_mpc": "map scale, h = 0.6766 (Planck18)",
                           "attractor_dist_cf4_mpc": "CF4 scale, H0 = 75.0 (Courtois et al. 2023)"},
             "ref": REF_DC23, "doi": DOI_DC23}
        if name.startswith("SDSS"):
            e["note"] = "far side unconstrained: streamlines reach the box edge (Dupuy & Courtois 2023, Sect. 3)"
        entries.append(e)
        if name in ("Laniakea", "Shapley", "Perseus-Pisces"):
            ara, adec = gal_to_radec(att_pc[None])
            aname = {"Laniakea": "Great Attractor", "Shapley": "Shapley attractor", "Perseus-Pisces": "Perseus-Pisces attractor"}[name]
            entries.append({"name": aname, "alt": (["Laniakea attractor", "GA"] if name == "Laniakea" else []), "kind": "attractor",
                            "ra": round(float(ara[0]), 4), "dec": round(float(adec[0]), 4),
                            "dist_pc": round(float(np.linalg.norm(att_pc)), -3), "xyz": r6(att_pc), "docs": "laniakea",
                            "facts": {"vcmb_kms": vcmb, "dist_cf4_mpc": round(float(np.linalg.norm(sgp)) / H_CF4, 1),
                                      "sg_hmpc": f"({sgp[0]}, {sgp[1]}, {sgp[2]})", "basin": name},
                            "facts_ref": {"vcmb_kms": REF_DC23, "dist_cf4_mpc": "CF4 scale, H0 = 75.0", "sg_hmpc": REF_DC23},
                            "ref": REF_DC23, "doi": DOI_DC23})
    lb = np.radians([VELA["l"], VELA["b"]])
    vg = np.array([np.cos(lb[1]) * np.cos(lb[0]), np.cos(lb[1]) * np.sin(lb[0]), np.sin(lb[1])]) * VELA["d_h"] * PC_PER_UNIT
    vra, vdec = gal_to_radec(vg[None])
    entries.append({"name": "Vela Supercluster", "alt": ["Vela SC", "VSCL"], "kind": "supercluster",
                    "ra": round(float(vra[0]), 4), "dec": round(float(vdec[0]), 4), "dist_pc": round(float(np.linalg.norm(vg)), -3),
                    "xyz": r6(vg), "docs": "laniakea",
                    "facts": {"dist_cf4_mpc": round(VELA["d_h"] / H_CF4, 1), "radius_mpc": round(VELA["radius_h"] / H_P18, 0),
                              "mass_msun": 3.38e17, "cz_kms": 18000},
                    "facts_ref": {"dist_cf4_mpc": "Hollinger et al. 2026, A&A accepted (arXiv:2603.09339): 189 h^-1 Mpc, H0 = 75",
                                  "radius_mpc": "Hollinger et al. 2026: 70 h^-1 Mpc, h = 0.6766",
                                  "mass_msun": "Hollinger et al. 2026: 33.8e16 M_sun (CF4++ with ZOA redshifts; this map's CF4++ grid has no ZOA data)",
                                  "cz_kms": "Kraan-Korteweg et al. 2017, MNRAS 466, L29; Hatamkhani et al. 2023 (l = 272.5 +- 20 deg, |b| <= 10 deg)"},
                    "ref": "Kraan-Korteweg et al. 2017, MNRAS 466, L29; Hollinger et al. 2026 (arXiv:2603.09339)"})

    # --- groups
    df = load_2mrs(a.cache)
    names = pgc_names(a.catalogs)
    agg, mem = build_groups(df, names)
    named = match_named(agg)
    fields = ["nest", "n", "pgc1", "name", "x", "y", "z", "dist_pc", "hv", "vcmba", "sigV", "sigP", "r2t_hmpc", "mlum_h12", "mvir_h12", "logLK"]
    rows, members = [], []
    nan = lambda x: None if not np.isfinite(x) else x  # noqa: E731
    for r in agg.sort_values("n", ascending=False).itertuples():
        nm = named.get(int(r.Nest), (None,))[0]
        rows.append([int(r.Nest), int(r.n), int(r.pgc1), nm, round(r.x, -3), round(r.y, -3), round(r.z, -3), round(r.dist_pc, -3),
                     int(round(r.hv)), int(r.vcmba), nan(r.sigV) if r.n >= 5 else None, nan(r.sigP), nan(r.r2t),
                     nan(r.mlum), nan(r.mvir), nan(r.logLK)])
        members.append([[p, n, k, hv] for p, n, k, hv in mem[int(r.Nest)]])
    groups_doc = {"version": 1, "h": round(H_P18, 4), "fields": fields, "rows": rows, "members": members,
                  "memberFields": ["pgc", "name", "Kmag", "hv_kms"],
                  "units": {"dist_pc": "Planck18 comoving distance of the members median heliocentric cz (as the 2MRS layer)",
                            "mlum_h12": "group mass from K luminosity, 1e12 h^-1 M_sun", "mvir_h12": "virial mass, 1e12 h^-1 M_sun",
                            "r2t_hmpc": "second-turnaround radius, h^-1 Mpc", "sigV": "LOS bi-weight velocity dispersion, km/s (>= 5 members)",
                            "sigP": "LOS dispersion expected from the luminosity, km/s", "vcmba": "Tully's adjusted CMB velocity, km/s",
                            "hv": "median heliocentric velocity of the members, km/s (the median: the Virgo nest lists two members at 45,376 and 65,081 km/s)"},
                  "ref": "Tully 2015, AJ 149, 171 (2MASS group catalogue), VizieR J/AJ/149/171", "doi": "10.1088/0004-6256/149/5/171"}
    (a.catalogs / "groups-2mrs.json").write_text(json.dumps(groups_doc, separators=(",", ":"), allow_nan=False) + "\n")

    # named clusters as catalogue entries (search, labels); members come from groups-2mrs.json
    for nest, (nm, alt, src) in named.items():
        row = agg[agg["Nest"] == nest]
        if not len(row):
            continue
        r = row.iloc[0]
        g = np.array([r.x, r.y, r.z])
        gra, gdec = gal_to_radec(g[None])
        facts = {"members_2mrs": int(r.n), "mass_lum_msun": float(f"{r.mlum * 1e12 / H_P18:.3g}")}
        if np.isfinite(r.mvir) and r.mvir > 0:
            facts["mass_vir_msun"] = float(f"{r.mvir * 1e12 / H_P18:.3g}")
        if np.isfinite(r.sigV) and r.n >= 5:
            facts["sigma_v_kms"] = int(r.sigV)
        facts["cz_helio_kms"] = int(round(r.hv))
        entries.append({"name": nm, "alt": alt + [f"2MRS nest {int(nest)}", f"PGC {int(r.pgc1)} group"], "kind": "galaxy_group",
                        "ra": round(float(gra[0]), 4), "dec": round(float(gdec[0]), 4), "dist_pc": round(float(r.dist_pc), -3),
                        "xyz": r6(g), "docs": "laniakea", "nest": int(nest),
                        "facts": facts,
                        "facts_ref": {"members_2mrs": "Tully 2015", "mass_lum_msun": "Tully 2015 Mlum (h^-1 M_sun), h = 0.6766",
                                      "mass_vir_msun": "Tully 2015 Mvir (h^-1 M_sun), h = 0.6766", "sigma_v_kms": "Tully 2015 sigV (bi-weight)",
                                      "cz_helio_kms": "median of the 2MRS members"},
                        "ref": f"Tully 2015, AJ 149, 171 (2MRS nest {int(nest)}); name: {src}", "doi": "10.1088/0004-6256/149/5/171"})
    (a.catalogs / "cosmography.json").write_text(json.dumps(entries, ensure_ascii=False, separators=(",", ":")) + "\n")

    # --- meta + provenance
    meta = {
        "layer": "cosmography", "frame": "supergalactic", "unit": "h^-1 Mpc",
        "toMap": {"rotation": "GAL_TO_SG (astropy Supergalactic); gal = M^T sg", "pcPerUnit": PC_PER_UNIT, "h": H_P18,
                  "note": "lengths in h^-1 Mpc drawn as L / h_Planck18 Mpc, the scale of the Planck18 redshift layers"},
        "scale": {"hPlanck18": H_P18, "H0_cf4": 75.0, "H0_cf4_err": 0.35, "H0_cf4_nominal": 74.6, "cf4OverMap": round(H_P18 / H_CF4, 4),
                  "ref": "Courtois et al. 2023, A&A 670, L15 (H0 = 75.0 +- 0.35 ungrouped CF4; 74.6 nominal, Tully et al. 2023)"},
        "grid": {"n": N, "box_h_mpc": L_BOX, "voxel_h_mpc": DL, "origin_h_mpc": [-L_BOX / 2] * 3, "order": "x fastest (SGX), then SGY, then SGZ"},
        "density": {"file": "density_rg8.bin", "format": "rg8", "bytes": N ** 3 * 2,
                    "r": {"quantity": "delta (HMC posterior mean density contrast)", "lo": D_LO, "hi": D_HI},
                    "g": {"quantity": "posterior std of delta", "lo": S_LO, "hi": S_HI},
                    "note": "code c -> lo + c/255 (hi - lo); values beyond clipped", "dataRadius_h_mpc": 300.0},
        "basins": {"file": "basins_u8.bin", "format": "r8", "bytes": N ** 3,
                   "names": {str(b[0]): b[1] for b in BASINS}, "source": "CF4 (2023) ungrouped basins of attraction"},
        "streams": {"file": "streams.bin", "lines": int(len(first)), "vertices": int(len(V)),
                    "layout": ["float32 x3 per vertex (SG h^-1 Mpc)", "uint32 first vertex per line", "uint16 vertex count per line",
                               "uint8 basin of the seed", "uint8 basin of the end point"],
                    "seeding": "every 3rd voxel (jittered, seed 7) within 200 h^-1 Mpc; RK4 on v/|v|, step 3.9 h^-1 Mpc, stop at |v| < 15 km/s, "
                               "r > 420 h^-1 Mpc or no progress over 10 steps; every 2nd point kept",
                    "agreement": agree, "sinks": found},
        "citation": f"{REF_CF4PP}; {REF_DC23}", "license": "no licence stated by the provider: 'If you use this data cite the article above'",
    }
    (a.out / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    prov = {
        "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sources": [
            {"url": IP2I + NPZ, "last_modified": NPZ_LAST_MODIFIED, "etag": "6acdee14-a0006be", "bytes": NPZ_BYTES,
             "sha256": gmeta["npz_sha256"], "erratum": "vr_mean fixed on 2026-10-13; this file is the post-erratum one",
             "hmc_steps": gmeta["hmc_steps"], "axis_check_rms_kms": gmeta["vr_check_rms_kms"]},
            {"url": IP2I + ZIP, "member": BOA, "sha256": gmeta["zip_sha256"]},
            {"url": VIZ, "rows": int(len(df)), "note": "CDS main down; CfA mirror"},
            {"url": "https://simbad.cfa.harvard.edu/simbad/sim-id", "use": "cluster centres for names", "clusters": [c[0] for c in CLUSTERS]},
        ],
        "outputs": {"density_rg8.bin": N ** 3 * 2, "basins_u8.bin": N ** 3, "streams.bin": (a.out / "streams.bin").stat().st_size,
                    "groups": len(rows), "group_members": int(sum(len(m) for m in members)), "catalogue_entries": len(entries)},
        "checks": {"streamline_basin_agreement": agree, "sinks_vs_published_attractors": found},
        "seconds": round(time.time() - t0, 1),
    }
    (a.out / "PROVENANCE.json").write_text(json.dumps(prov, indent=1) + "\n")
    (a.catalogs / "provenance" / "cosmography.json").write_text(json.dumps(prov, indent=1) + "\n")
    print(json.dumps({"lines": len(first), "vertices": len(V), "groups": len(rows), "entries": len(entries),
                      "named": {int(k): v[0] for k, v in named.items()}, "agree": agree, "sinks": found}, indent=1))
    for f in sorted(a.out.iterdir()):
        print(f.name, f.stat().st_size)
    print("groups-2mrs.json", (a.catalogs / "groups-2mrs.json").stat().st_size, "cosmography.json", (a.catalogs / "cosmography.json").stat().st_size)


if __name__ == "__main__":
    main()
