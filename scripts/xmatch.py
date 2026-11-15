"""Position + redshift cross-match used to de-duplicate redshift surveys against each other.

A source counts as a duplicate of a reference object when a reference lies within `radius_arcsec`
on the sky AND |z_src - z_ref| < dz. Positions are matched as chords between unit vectors with a
scipy cKDTree (exact for the small radii used here: chord = 2 sin(theta/2)).

The k nearest reference neighbours inside the radius are checked, so a source next to a close pair
is still matched to the right one. `match()` returns per-source arrays; `summary()` turns them into
the numbers written to PROVENANCE.json.
"""
from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree

ARCSEC = np.pi / (180.0 * 3600.0)


def unit_vectors(ra_deg, dec_deg) -> np.ndarray:
    ra = np.radians(np.asarray(ra_deg, dtype=np.float64))
    dec = np.radians(np.asarray(dec_deg, dtype=np.float64))
    cd = np.cos(dec)
    return np.stack([cd * np.cos(ra), cd * np.sin(ra), np.sin(dec)], axis=1)


class RefCatalogue:
    """KD-tree over a reference catalogue (built once, queried by several source catalogues)."""

    def __init__(self, name: str, ra, dec, z):
        self.name = name
        self.z = np.asarray(z, dtype=np.float64)
        self.tree = cKDTree(unit_vectors(ra, dec), leafsize=32, balanced_tree=False, compact_nodes=False)
        self.n = len(self.z)

    def match(self, ra, dec, z, radius_arcsec: float = 1.0, dz=0.002, k: int = 4) -> dict:
        """Per source: `pos` (a reference within the radius), `dup` (one within the radius with
        |dz| < dz; dz is a scalar or one tolerance per source),`sep_arcsec`/`dz` of the best reference (the redshift-agreeing one if any,
        else the nearest), `ref_index` (-1 = none)."""
        xyz = unit_vectors(ra, dec)
        zs = np.asarray(z, dtype=np.float64)
        rchord = 2.0 * np.sin(radius_arcsec * ARCSEC / 2.0)
        d, idx = self.tree.query(xyz, k=k, distance_upper_bound=rchord, workers=-1)
        if d.ndim == 1:  # k == 1
            d, idx = d[:, None], idx[:, None]
        inside = np.isfinite(d) & (idx < self.n)
        safe = np.where(inside, idx, 0)
        dzz = np.where(inside, np.abs(zs[:, None] - self.z[safe]), np.inf)
        tol = np.asarray(dz, dtype=np.float64)
        agree = inside & (dzz < (tol[:, None] if tol.ndim == 1 else tol))
        pos = inside.any(axis=1)
        dup = agree.any(axis=1)
        # best reference: first agreeing neighbour (neighbours are sorted by distance), else nearest
        first_agree = np.argmax(agree, axis=1)
        col = np.where(dup, first_agree, 0)
        rows = np.arange(len(zs))
        best = np.where(pos, idx[rows, col], -1)
        sep = np.where(pos, 2.0 * np.arcsin(np.clip(d[rows, col], 0, 2) / 2.0) / ARCSEC, np.nan)
        bdz = np.where(pos, (zs - self.z[np.where(best >= 0, best, 0)]), np.nan)
        return {"pos": pos, "dup": dup, "ref_index": best, "sep_arcsec": sep, "dz": bdz}


def summary(m: dict, ref: str, kind=None, radius_arcsec: float = 1.0, dz=0.002) -> dict:
    pos, dup = m["pos"], m["dup"]
    conflict = pos & ~dup
    out = {
        "reference": ref,
        "criterion": f"separation <= {radius_arcsec} arcsec AND |dz| < "
                     f"{dz if np.ndim(dz) == 0 else 'per-source tolerance (see selection)'}",
        "position_matches": int(pos.sum()),
        "duplicates": int(dup.sum()),
        "position_match_redshift_disagrees": int(conflict.sum()),
    }
    if conflict.any():
        adz = np.abs(m["dz"][conflict])
        out["redshift_disagreement_abs_dz_percentiles_16_50_84"] = [round(float(v), 5) for v in np.percentile(adz, [16, 50, 84])]
        out["redshift_disagreement_abs_dz_gt_0.01"] = int((adz > 0.01).sum())
    if dup.any():
        out["duplicate_sep_arcsec_median"] = round(float(np.nanmedian(m["sep_arcsec"][dup])), 3)
        out["duplicate_abs_dz_median"] = float(f"{np.nanmedian(np.abs(m['dz'][dup])):.3g}")
    if kind is not None:
        kind = np.asarray(kind)
        out["by_kind"] = {str(k): {"rows": int((kind == k).sum()), "duplicates": int((dup & (kind == k)).sum()),
                                   "position_match_redshift_disagrees": int((conflict & (kind == k)).sum())}
                          for k in np.unique(kind)}
    return out


def self_test() -> None:
    rng = np.random.default_rng(1)
    ra = rng.uniform(0, 360, 2000)
    dec = np.degrees(np.arcsin(rng.uniform(-1, 1, 2000)))
    z = rng.uniform(0.01, 1, 2000)
    ref = RefCatalogue("t", ra, dec, z)
    # shifted by 0.5" (match), 1.5" (no match); z equal / off by 0.01
    off = 0.5 / 3600.0
    m = ref.match(ra[:4], dec[:4] + np.array([off, off, 3 * off, 0.0]), z[:4] + np.array([0, 0.01, 0, 0.0015]))
    assert m["pos"].tolist() == [True, True, False, True], m
    assert m["dup"].tolist() == [True, False, False, True], m
    assert abs(m["sep_arcsec"][0] - 0.5) < 1e-3, m["sep_arcsec"]
    print("xmatch self-test OK")


if __name__ == "__main__":
    self_test()
