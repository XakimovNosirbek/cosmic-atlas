#!/usr/bin/env python
"""Fetch 6dFGS DR3 and 2dFGRS (final) redshifts -> data/raw/galaxies-6dfgs/, data/raw/galaxies-2dfgrs/,
each de-duplicated against the surveys already in the atlas.

  galaxies-6dfgs : 6dF Galaxy Survey final redshift release (Jones et al. 2009), VizieR VII/259/6dfgs.
                   Cuts: q_cz in {3, 4} (VizieR ReadMe note 5 / Jones et al. 2004: 3 = 'probable', notionally
                   90 % confidence, 4 = reliable, 99 %; 1 = unusable, 2 = doubtful, 6 = Galactic, 9 = SDSS/ZCAT
                   value with no quality), r_cz = 126 (the redshift is a 6dFGS measurement, not one imported
                   from ZCAT, SDSS or 2dFGRS) and e_cz > 0 (0 marks 6dFGS redshifts unsuitable for extragalactic use).
  galaxies-2dfgrs: 2dF Galaxy Redshift Survey final release (Colless et al. 2001, 2003), VizieR VII/250/2dfgrs
                   (best observation per object). Cut: q_z >= 3 (Colless et al. 2001 sec. 7: "reliable
                   redshifts have quality >= 3", the survey's standard sample).
  Both: z >= 0.003 (contract: no Hubble-flow distance below z = 0.003; this also removes the stars,
  which sit at |cz| < a few hundred km/s), rows without a redshift dropped.

De-duplication (keep the earlier survey): DESI DR1 > SDSS DR17 > 2MRS > 6dFGS > 2dFGRS. A row is a
duplicate when an object of a higher-priority survey lies within 3 arcsec AND |dz| < 0.002
(scripts/xmatch.py). The radius is 3", not the 1" used for SDSS vs DESI, because 6dFGS/2dFGRS positions come
from photographic plates (SuperCOSMOS/APM) and 2MASS: the 2dFGRS-DESI duplicates have a median separation
of 0.54", and widening 1" -> 3" catches 10,076 more 2dFGRS-DESI duplicates (54,917 -> 64,993) while the
chance baseline (positions moved 1' north) is 29 at 3" (measured 2026-11-14). The 1" counts are reported
too (`duplicates_at_1arcsec`). SDSS is the full cleaned DR17 table
(data/raw/galaxies-sdss/parts/sdss_dr17_clean.parquet), not only the SDSS objects new to DESI, so an
object seen by SDSS and DESI is caught either way.

VizieR: CfA mirror (vizier.cfa.harvard.edu); CDS Strasbourg has been down since 2026-11-09.
Usage: .venv/bin/python scripts/fetch_6df_2df.py [--refresh]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import ROOT, VIZIER, fetch_vizier, num, utcnow  # noqa: E402
from coords import C_KMS, comoving_pc  # noqa: E402
from xmatch import RefCatalogue, summary  # noqa: E402

RAW = ROOT / "data" / "raw"
Z_MIN = 0.003
MATCH_ARCSEC = 3.0  # see the docstring
STRICT_ARCSEC = 1.0
MATCH_DZ = 0.002
# 2dFGRS redshift uncertainty per quality from repeats (Colless et al. 2001; as quoted in the VizieR
# VII/259 ReadMe note 3): Q=3 123 km/s, Q>=4 89 km/s. No per-object error is published.
ZERR_2DF_KMS = {3: 123.0, 4: 89.0, 5: 89.0}

CIT_6DF = [
    {"ref": "Jones et al. 2009, MNRAS 399, 683 (6dFGS DR3, final redshift release)", "doi": "10.1111/j.1365-2966.2009.15338.x"},
    {"ref": "Jones et al. 2004, MNRAS 355, 747 (6dFGS: samples, observational techniques and DR1; quality scale)",
     "doi": "10.1111/j.1365-2966.2004.08353.x"},
]
CIT_2DF = [
    {"ref": "Colless et al. 2001, MNRAS 328, 1039 (2dFGRS: spectra and redshifts)", "doi": "10.1046/j.1365-8711.2001.04902.x"},
    {"ref": "Colless et al. 2003, arXiv:astro-ph/0306581 (2dFGRS: the final data release)", "doi": "10.48550/arXiv.astro-ph/0306581"},
]
CIT_COMMON = [
    {"ref": "VizieR (Ochsenbein, Bauer & Marcout 2000, A&AS 143, 23), CfA mirror", "doi": "10.1051/aas:2000169"},
    {"ref": "Planck Collaboration 2020, A&A 641, A6 (Planck18 cosmology)", "doi": "10.1051/0004-6361/201833910"},
]


def zhist(z, step=0.02, top=0.5) -> dict:
    edges = np.round(np.arange(0, top + 1e-9, step), 3)
    h, _ = np.histogram(np.clip(z, 0, top - 1e-9), bins=edges)
    return {f"{edges[i]:.2f}-{edges[i+1]:.2f}": int(h[i]) for i in range(len(h)) if h[i]}


class Refs:
    """Higher-priority surveys, loaded lazily (DESI is 15 M rows)."""

    def __init__(self):
        self._cache: dict[str, RefCatalogue] = {}

    def get(self, name: str) -> RefCatalogue:
        if name in self._cache:
            return self._cache[name]
        if name == "DESI DR1":
            t = pq.read_table(RAW / "galaxies-desi" / "galaxies-desi.parquet", columns=["ra", "dec", "z"]).to_pandas()
        elif name == "SDSS DR17":
            t = pq.read_table(RAW / "galaxies-sdss" / "parts" / "sdss_dr17_clean.parquet", columns=["ra", "dec", "z"]).to_pandas()
        elif name == "2MRS":
            t = pq.read_table(RAW / "galaxies-2mrs" / "galaxies-2mrs.parquet", columns=["ra", "dec", "z"]).to_pandas()
        elif name == "6dFGS DR3":
            t = pq.read_table(RAW / "galaxies-6dfgs" / "parts" / "6dfgs_clean.parquet", columns=["ra", "dec", "z"]).to_pandas()
        else:
            raise KeyError(name)
        self._cache[name] = RefCatalogue(name, t["ra"].to_numpy(), t["dec"].to_numpy(), t["z"].to_numpy())
        return self._cache[name]


def dedupe(df: pd.DataFrame, refs: Refs, order: list[str]) -> tuple[pd.DataFrame, list[dict]]:
    """Sequentially remove duplicates of each reference; returns the survivors and a report per step."""
    keep = np.ones(len(df), bool)
    report = []
    for name in order:
        t0 = time.time()
        ref = refs.get(name)
        m = ref.match(df["ra"].to_numpy(), df["dec"].to_numpy(), df["z"].to_numpy(), MATCH_ARCSEC, MATCH_DZ)
        s = summary(m, f"{name} ({ref.n} rows)", radius_arcsec=MATCH_ARCSEC, dz=MATCH_DZ)
        s["duplicates_not_already_removed"] = int((m["dup"] & keep).sum())
        m1 = ref.match(df["ra"].to_numpy(), df["dec"].to_numpy(), df["z"].to_numpy(), STRICT_ARCSEC, MATCH_DZ)
        s["duplicates_at_1arcsec"] = int(m1["dup"].sum())
        mc = ref.match(df["ra"].to_numpy(), np.clip(df["dec"].to_numpy() + 1 / 60, -90, 90), df["z"].to_numpy(),
                       MATCH_ARCSEC, MATCH_DZ)
        s["chance_baseline_dec_plus_1arcmin"] = {"position_matches": int(mc["pos"].sum()), "duplicates": int(mc["dup"].sum())}
        s["seconds"] = round(time.time() - t0, 1)
        df[f"dup_{name.split()[0].lower()}"] = m["dup"]
        keep &= ~m["dup"]
        report.append(s)
    return df[keep].reset_index(drop=True), report


def write(layer: str, df_clean: pd.DataFrame, df_new: pd.DataFrame, prov: dict) -> dict:
    out = RAW / layer
    (out / "parts").mkdir(parents=True, exist_ok=True)
    clean = out / "parts" / f"{layer.split('-')[1]}_clean.parquet"
    pq.write_table(pa.Table.from_pandas(df_clean, preserve_index=False), clean, compression="zstd")
    dest = out / f"{layer}.parquet"
    pq.write_table(pa.Table.from_pandas(df_new, preserve_index=False), dest, compression="zstd")
    prov = {"layer": layer, **prov, "rows_final": int(len(df_new)), "file": str(dest.relative_to(ROOT)),
            "file_bytes": dest.stat().st_size, "clean_full_table": str(clean.relative_to(ROOT)), "finished_utc": utcnow()}
    (out / "PROVENANCE.json").write_text(json.dumps(prov, indent=2, ensure_ascii=False))
    return prov


def contract(df: pd.DataFrame) -> pd.DataFrame:
    df["id"] = df["id"].astype("string")
    for c in ["ra", "dec", "dist_pc", "dist_lo_pc", "dist_hi_pc", "z"]:
        df[c] = df[c].astype("float64")
    for c in ["mag", "color", "zerr"]:
        df[c] = df[c].astype("float32")
    df["kind"] = pd.Categorical(["galaxy"] * len(df), categories=["galaxy", "qso"])
    return df


def build_6dfgs(refresh: bool, refs: Refs) -> dict:
    started = utcnow()
    cols = ["6dFGS", "Target", "bJmag", "rFmag", "S/G", "cz", "e_cz", "r_cz", "q_cz", "Nz", "AV"]
    raw, url = fetch_vizier("VII/259/6dfgs", RAW / "galaxies-6dfgs" / "source" / "vii_259_6dfgs.tsv", cols, refresh=refresh)
    n_src = len(raw)
    q = num(raw["q_cz"])
    cz = num(raw["cz"])
    cuts = {"rows_source": n_src, "q_cz_counts": {str(int(k)) if np.isfinite(k) else "blank": int(v)
                                                   for k, v in pd.Series(q).value_counts(dropna=False).sort_index().items()}}
    src = num(raw["r_cz"])
    ecz = num(raw["e_cz"])
    cuts["r_cz_counts"] = {str(int(k)) if np.isfinite(k) else "blank": int(v)
                           for k, v in pd.Series(src).value_counts(dropna=False).sort_index().items()}
    good = np.isin(q, [3, 4]) & np.isfinite(cz)
    cuts["q_cz_3_or_4_with_cz"] = int(good.sum())
    cuts["q_cz_3_or_4_by_quality"] = {"3": int((good & (q == 3)).sum()), "4": int((good & (q == 4)).sum())}
    not6df = good & (src != 126)
    cuts["redshift_not_from_6dfgs_removed"] = int(not6df.sum())
    good &= ~not6df
    zero_err = good & ~(ecz > 0)
    cuts["e_cz_le_0_removed"] = int(zero_err.sum())
    good &= ~zero_err
    z = cz / C_KMS
    lowz = good & (z < Z_MIN)
    cuts["z_lt_0.003_removed"] = int(lowz.sum())
    good &= ~lowz
    r = raw[good].reset_index(drop=True)
    z = z[good]
    ezk = num(r["e_cz"])
    zerr = np.where(np.isfinite(ezk) & (ezk > 0), ezk, np.nan) / C_KMS
    bj, rf = num(r["bJmag"]), num(r["rFmag"])
    target = num(r["Target"]).astype(np.int64)
    df = pd.DataFrame({
        "id": [f"6dFGS {n}" for n in r["6dFGS"]],
        "numeric_id": target.astype(np.uint64),
        "name": r["6dFGS"].astype(str).to_numpy(),
        "ra": num(r["_RAJ2000"]), "dec": num(r["_DEJ2000"]),
        "dist_pc": comoving_pc(z),
        "dist_lo_pc": comoving_pc(np.clip(z - np.nan_to_num(zerr), 0, None)),
        "dist_hi_pc": comoving_pc(z + np.nan_to_num(zerr)),
        "mag": rf, "color": bj - rf,
        "z": z, "zerr": zerr,
        "cz_kms": cz[good].astype(np.float32), "e_cz_kms": ezk.astype(np.float32),
        "q_cz": q[good].astype(np.int8), "r_cz": num(r["r_cz"]).astype(np.float32),
        "av": num(r["AV"]).astype(np.float32),
    })
    nolo = ~np.isfinite(zerr)
    df.loc[nolo, ["dist_lo_pc", "dist_hi_pc"]] = np.nan
    df = contract(df)
    clean = df.copy()
    new, report = dedupe(df, refs, ["DESI DR1", "SDSS DR17", "2MRS"])
    clean_path_df = clean.drop(columns=[c for c in clean.columns if c.startswith("dup_")])
    prov = {
        "service": VIZIER, "request_url": url, "table": "VII/259/6dfgs",
        "started_utc": started,
        "selection": {
            "source": "all rows of VII/259/6dfgs (6dFGS DR3 redshift catalogue)",
            "cuts": ["q_cz in {3, 4} ('probable' 90 % / reliable 99 % confidence; ReadMe note 5, Jones et al. 2004)",
                     "r_cz = 126 (6dFGS's own measurement; ZCAT/SDSS/2dFGRS values imported into the table dropped)",
                     "e_cz > 0 (0 = unsuitable for extragalactic use, ReadMe note 3)",
                     "cz present", f"z = cz/c >= {Z_MIN} (contract; removes Galactic stars)"],
            "dedup": f"drop rows with a DESI DR1, SDSS DR17 or 2MRS object within {MATCH_ARCSEC} arcsec and |dz| < {MATCH_DZ}",
        },
        "columns": {
            "ra/dec": "VizieR _RAJ/_DEJ (J2000, decimal)",
            "z": "cz / c (heliocentric best combined cz)",
            "dist_pc": "Planck18 comoving distance of z; lo/hi from cz -/+ e_cz",
            "mag": "recalibrated SuperCOSMOS r_F (Vega), not extinction corrected (rendering proxy only)",
            "color": "b_J - r_F",
            "numeric_id": "6dFGS database TARGETID",
        },
        "cuts": cuts,
        "rows_after_cuts": int(len(clean)),
        "dedup": report,
        "z_hist_0.02_after_cuts": zhist(clean["z"].to_numpy()),
        "z_hist_0.02_final": zhist(new["z"].to_numpy()),
        "citations": CIT_6DF + CIT_COMMON,
        "licence": "None stated by the survey (6dfgs.net, last updated 2014). VizieR copy under the CDS conditions "
                   "(https://cds.unistra.fr/vizier-org/licences_vizier.html); cite Jones et al. 2009 and CDS/VizieR.",
        "acknowledgement": "This research uses data from the 6dF Galaxy Survey (Jones et al. 2004, 2009).",
    }
    p = write("galaxies-6dfgs", clean_path_df, new, prov)
    return p


def build_2dfgrs(refresh: bool, refs: Refs) -> dict:
    started = utcnow()
    cols = ["SeqNum", "Name", "Bjsel", "Bjmag.S", "Rmag.S", "z", "z.obs", "q_z", "n_z", "SNR"]
    raw, url = fetch_vizier("VII/250/2dfgrs", RAW / "galaxies-2dfgrs" / "source" / "vii_250_2dfgrs.tsv", cols, refresh=refresh)
    n_src = len(raw)
    q = num(raw["q_z"])
    z = num(raw["z"])
    cuts = {"rows_source": n_src, "q_z_counts": {str(int(k)) if np.isfinite(k) else "blank": int(v)
                                                 for k, v in pd.Series(q).value_counts(dropna=False).sort_index().items()}}
    good = (q >= 3) & np.isfinite(z)
    cuts["q_z_ge_3_with_z"] = int(good.sum())
    lowz = good & (z < Z_MIN)
    cuts["z_lt_0.003_removed"] = int(lowz.sum())
    good &= ~lowz
    r = raw[good].reset_index(drop=True)
    z = z[good]
    zerr = np.array([ZERR_2DF_KMS[int(min(v, 5))] for v in q[good]]) / C_KMS
    bj = num(r["Bjsel"])
    rs, bs = num(r["Rmag.S"]), num(r["Bjmag.S"])
    df = pd.DataFrame({
        "id": [f"2dFGRS {n}" for n in r["Name"]],
        "numeric_id": num(r["SeqNum"]).astype(np.int64).astype(np.uint64),
        "name": r["Name"].astype(str).to_numpy(),
        "ra": num(r["_RAJ2000"]), "dec": num(r["_DEJ2000"]),
        "dist_pc": comoving_pc(z),
        "dist_lo_pc": comoving_pc(z - zerr),
        "dist_hi_pc": comoving_pc(z + zerr),
        "mag": bj, "color": bs - rs,
        "z": z, "zerr": zerr,
        "z_obs": num(r["z.obs"]).astype(np.float32),
        "q_z": q[good].astype(np.int8), "snr": num(r["SNR"]).astype(np.float32),
    })
    df = contract(df)
    clean = df.copy()
    new, report = dedupe(df, refs, ["DESI DR1", "SDSS DR17", "2MRS", "6dFGS DR3"])
    prov = {
        "service": VIZIER, "request_url": url, "table": "VII/250/2dfgrs",
        "started_utc": started,
        "selection": {
            "source": "all rows of VII/250/2dfgrs (best observation of each 2dFGRS object)",
            "cuts": ["q_z >= 3 (reliable redshift; Colless et al. 2001)", "z present",
                     f"z (heliocentric) >= {Z_MIN} (contract; removes stars)"],
            "dedup": f"drop rows with a DESI DR1, SDSS DR17, 2MRS or 6dFGS DR3 object within {MATCH_ARCSEC} arcsec "
                     f"and |dz| < {MATCH_DZ}",
        },
        "columns": {
            "ra/dec": "VizieR _RAJ/_DEJ (J2000, decimal)",
            "z": "Z_HELIO (heliocentric)",
            "dist_pc": "Planck18 comoving distance of z; lo/hi from z -/+ (123 km/s for Q=3, 89 km/s for Q>=4) / c "
                       "(survey rms from repeats, Colless et al. 2001; no per-object error is published)",
            "mag": "BJSEL (b_J corrected for Galactic extinction), Vega",
            "color": "SuperCOSMOS b_J - R (not extinction corrected; NaN where missing)",
            "numeric_id": "2dFGRS SEQNUM",
        },
        "cuts": cuts,
        "rows_after_cuts": int(len(clean)),
        "dedup": report,
        "z_hist_0.02_after_cuts": zhist(clean["z"].to_numpy()),
        "z_hist_0.02_final": zhist(new["z"].to_numpy()),
        "citations": CIT_2DF + CIT_COMMON,
        "licence": "None found on the 2dFGRS pages (www.2dfgrs.net). VizieR copy under the CDS conditions "
                   "(https://cds.unistra.fr/vizier-org/licences_vizier.html); cite Colless et al. 2001 and CDS/VizieR.",
        "acknowledgement": "This research uses data from the 2dF Galaxy Redshift Survey (Colless et al. 2001).",
    }
    clean = clean.drop(columns=[c for c in clean.columns if c.startswith("dup_")])
    return write("galaxies-2dfgrs", clean, new, prov)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download the VizieR tables")
    ap.add_argument("--only", choices=["6dfgs", "2dfgrs"])
    a = ap.parse_args()
    refs = Refs()
    out = {}
    if a.only in (None, "6dfgs"):
        out["galaxies-6dfgs"] = build_6dfgs(a.refresh, refs)
    if a.only in (None, "2dfgrs"):
        out["galaxies-2dfgrs"] = build_2dfgrs(a.refresh, refs)
    for k, p in out.items():
        print(k, json.dumps({x: p[x] for x in ("cuts", "rows_after_cuts", "dedup", "rows_final")}, indent=1))


if __name__ == "__main__":
    main()
