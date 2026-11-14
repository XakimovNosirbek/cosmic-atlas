#!/usr/bin/env python
"""Fetch a high-purity Euclid DR1 (DR1-Foundation, released 2026-11-12) NISP spectroscopic-redshift
sample -> data/raw/galaxies-euclid/.

Why only this sample. DR1-Foundation extracts a slitless spectrum for every source with HE < 23.5 and
gives most of them a redshift; the release overview (Euclid Collaboration: Aussel et al. 2026, sec. 3.8)
cautions "against blindly using the redshifts: many spectra do not show any measurable features, yet
have an entry in the SPE catalogue". The DR1 SPE paper (Euclid Collaboration: Le Brun et al. 2026,
"Euclid DR1: Performance of the redshift measurement and spectroscopic analysis", sec. 4.3/5) measures
that in the Wide Survey even high spe_z_prob gives <= 80 % correct redshifts, < 10 % at z < 0.1 and
~40-60 % at 0.1 < z < 0.84. Its one sample validated against DESI at the ~99 % level is the Euclid Deep
Field North (7 RGS + 3 BGS visits), selected as follows (sec. 4.3), which this script reproduces:

  spectrum : spe_n_dith_med >= 15, spe_npix >= 800 (complete spectra from many visits; only EDF-N
             BGS+RGS spectra pass, EDF-S/EDF-F RGS-only spectra have npix 496)
  object   : MER point_like_prob < 0.05, spurious_prob < 0.5, kron_radius < 50 (no stars, no large
             nearby galaxies, no spurious detections)
  redshift : best (rank 0) galaxy solution with 0.85 <= z <= 1.85 (H-alpha inside the red grism),
             H-alpha (rank 0) flux_gf > 1.5e-16 erg/s/cm2 and snr_gf > 0,
             gal.spe_z_prob > 0.94 and gal.spe_z_rel > 0.05
  -> "a sample of 3863 objects with a 98.9 % success rate compared to DESI" (those with a DESI match).

Access: NASA/IPAC IRSA TAP (Euclid DR1 mirror), async jobs. Stage 1 scans the galaxy-candidate table
with the redshift cuts, stage 2 the spectrum-quality table, stage 3 the H-alpha line table (each with its
own cuts; intersected locally on object_id), and stage 4 uploads the stage 1+2 object_ids (TAP_UPLOAD, one
request) to join the MER catalogue with its cuts; stages 3 and 4 run concurrently. A single upload join of all 1.79 M stage-1 ids was
too heavy. Each stage result is cached in parts/; re-runs skip it. On 2026-11-14 the stage-1 async job
took 42 min.
De-duplication against DESI DR1 (1 arcsec, |dz| < 0.002, keep DESI), SDSS DR17, 2MRS, 6dFGS and 2dFGRS
(scripts/xmatch.py). Licence: CC BY-NC 3.0 IGO.

Usage: .venv/bin/python scripts/fetch_euclid.py [--refresh-stage N]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import io
import datetime as dt
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pyvo
import requests
from astropy.table import Table

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coords import comoving_pc  # noqa: E402
from xmatch import RefCatalogue, summary  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = RAW / "galaxies-euclid"
PARTS = OUT / "parts"
TAP_URL = "https://irsa.ipac.caltech.edu/TAP"
T_GAL = "euclid_dr1_spectro_z_spe_galaxy_candidates_deep"
T_QUAL = "euclid_dr1_spectro_z_spe_quality_deep"
T_LINE = "euclid_dr1_spectro_line_features_spe_line_features_deep"
T_MER = "euclid_dr1_mer_catalogue_deep_survey"
MATCH_ARCSEC = 1.0
MATCH_DZ = 0.002

CUTS = {
    "z_min": 0.85, "z_max": 1.85, "spe_z_prob_gt": 0.94, "spe_z_rel_gt": 0.05,
    "n_dith_med_ge": 15, "npix_ge": 800, "halpha_flux_gf_gt": 1.5e-16, "halpha_snr_gf_gt": 0.0,
    "point_like_prob_lt": 0.05, "spurious_prob_lt": 0.5, "kron_radius_lt": 50.0,
}
Q_GAL = f"""SELECT object_id, spe_z, spe_z_err, spe_z_prob, spe_z_rel, spe_subclass, basic_download_data_oid
FROM {T_GAL}
WHERE spe_rank = 0 AND spe_z >= {CUTS['z_min']} AND spe_z <= {CUTS['z_max']}
 AND spe_z_prob > {CUTS['spe_z_prob_gt']} AND spe_z_rel > {CUTS['spe_z_rel_gt']}"""
Q_QUAL = f"""SELECT object_id, spe_n_dith_med, spe_npix, spe_grism FROM {T_QUAL}
WHERE spe_n_dith_med >= {CUTS['n_dith_med_ge']} AND spe_npix >= {CUTS['npix_ge']}"""
Q_HA = f"""SELECT object_id, spe_line_flux_gf AS ha_flux, spe_line_flux_err_gf AS ha_flux_err, spe_line_snr_gf AS ha_snr
FROM {T_LINE}
WHERE spe_rank = 0 AND spe_line_name = 'Halpha'
 AND spe_line_flux_gf > {CUTS['halpha_flux_gf_gt']} AND spe_line_snr_gf > {CUTS['halpha_snr_gf_gt']}"""
# MER rows for the objects that pass every SPE cut, by TAP_UPLOAD in chunks
Q_MER = f"""SELECT m.object_id, m.ra, m.dec, m.point_like_prob, m.spurious_prob, m.kron_radius,
 m.flux_h_templfit, m.flux_vis_to_h_templfit, m.tileid
FROM TAP_UPLOAD.ids AS u JOIN {T_MER} AS m ON m.object_id = u.object_id
WHERE m.point_like_prob < {CUTS['point_like_prob_lt']} AND m.spurious_prob < {CUTS['spurious_prob_lt']}
 AND m.kron_radius < {CUTS['kron_radius_lt']}"""
MER_CHUNK = 1_000_000  # one upload: each request is a full scan of the MER table

CITATIONS = [
    {"what": "Euclid DR1 overview", "ref": "Euclid Collaboration: Aussel et al. 2026, A&A (DR1 overview), "
     "https://pubs.euclid-ec.org/public/dr1/aussel.pdf", "doi": None},
    {"what": "Euclid DR1 SPE redshifts (selection reproduced here)", "ref": "Euclid Collaboration: Le Brun et al. 2026, "
     "A&A, Euclid DR1: Performance of the redshift measurement and spectroscopic analysis, "
     "https://pubs.euclid-ec.org/public/dr1/lebrun.pdf", "doi": None},
    {"what": "Euclid mission", "ref": "Euclid Collaboration: Mellier et al. 2025, A&A 697, A1", "doi": "10.1051/0004-6361/202450810"},
    {"what": "IRSA Euclid archive", "ref": "NASA/IPAC Infrared Science Archive, Euclid DR1 (doi on the IRSA page)", "doi": None},
    {"what": "Planck 2018 cosmology (distances)", "ref": "Planck Collaboration 2020, A&A 641, A6", "doi": "10.1051/0004-6361/201833910"},
]
ACK = ("This work has made use of the Euclid Data Release 1 (DR1) from the European Space Agency (ESA) mission Euclid, "
       "available at https://www.cosmos.esa.int/web/euclid/data-release-dr1 ; data accessed through the NASA/IPAC "
       "Infrared Science Archive (IRSA).")


def utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


MODE = {"tap": "async"}


def run_async(svc, q: str, uploads=None, maxrec: int = 20_000_000, timeout: int = 7200) -> Table:
    """One TAP query with retries: async job (default) or one long sync request (--sync; on
    2026-11-14 IRSA's async queue held a job for > 40 min while the same sync scan returned faster)."""
    delay = 30.0
    for attempt in range(1, 5):
        job = None
        try:
            if MODE["tap"] == "sync" and not uploads:
                # CSV is ~4x smaller than TABLEDATA VOTable; the read timeout catches a stalled
                # connection (one sync request hung for hours after the host slept, 2026-11-14)
                r = requests.post(f"{TAP_URL}/sync", data={"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv",
                                  "MAXREC": str(maxrec), "QUERY": q}, timeout=(60, 1800),
                                  headers={"User-Agent": "cosmic-atlas-fetch/1.0"})
                r.raise_for_status()
                if r.text.lstrip().startswith("<"):
                    raise RuntimeError(f"TAP error: {r.text[:300]}")
                return Table.from_pandas(pd.read_csv(io.StringIO(r.text)))
            if MODE["tap"] == "sync":
                res = svc.run_sync(q, maxrec=maxrec, uploads=uploads)
                if getattr(res, "query_status", "OK") == "OVERFLOW":
                    raise RuntimeError("result OVERFLOW (maxrec hit)")
                return res.to_table()
            job = svc.submit_job(q, maxrec=maxrec, uploads=uploads) if uploads else svc.submit_job(q, maxrec=maxrec)
            job.run()
            job.wait(phases=["COMPLETED", "ERROR", "ABORTED"], timeout=timeout)
            if job.phase != "COMPLETED":
                job.raise_if_error()
                raise RuntimeError(f"job phase {job.phase}")
            res = job.fetch_result()
            if getattr(res, "query_status", "OK") == "OVERFLOW":
                raise RuntimeError("result OVERFLOW (maxrec hit)")
            return res.to_table()
        except Exception as exc:
            print(f"  TAP attempt {attempt} failed: {exc}", flush=True)
            if attempt == 4:
                raise
            time.sleep(delay)
            delay *= 2
        finally:
            if job is not None:
                try:
                    job.delete()
                except Exception:
                    pass
    raise RuntimeError("unreachable")


def stage(name: str, refresh: bool, fn) -> tuple[pd.DataFrame, dict]:
    dest = PARTS / f"{name}.parquet"
    if dest.exists() and not refresh:
        meta = json.loads((PARTS / f"{name}.json").read_text())
        return pd.read_parquet(dest), meta
    t0, started = time.time(), utcnow()
    df = fn()
    df.to_parquet(dest, index=False)
    meta = {"rows": len(df), "started_utc": started, "seconds": round(time.time() - t0, 1)}
    (PARTS / f"{name}.json").write_text(json.dumps(meta))
    return df, meta


def to_pandas(t: Table) -> pd.DataFrame:
    df = t.to_pandas()
    for c in df.columns:
        if df[c].dtype == object:
            df[c] = df[c].astype(str).str.strip()
    return df


def zhist(z, step=0.1) -> dict:
    edges = np.round(np.arange(0, 2.0 + 1e-9, step), 2)
    h, _ = np.histogram(z, bins=edges)
    return {f"{edges[i]:.1f}-{edges[i+1]:.1f}": int(h[i]) for i in range(len(h)) if h[i]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh-stage", type=int, action="append", default=[],
                    help="1 = galaxy scan, 2 = quality scan, 3 = H-alpha scan, 4 = MER upload joins")
    ap.add_argument("--sync", action="store_true", help="synchronous TAP requests instead of async jobs")
    a = ap.parse_args()
    MODE["tap"] = "sync" if a.sync else "async"
    PARTS.mkdir(parents=True, exist_ok=True)
    started = utcnow()
    svc = pyvo.dal.TAPService(TAP_URL)

    # three single-table scans (each table's own cuts), intersected here on object_id
    gal, m1 = stage("stage1_galaxy_candidates", 1 in a.refresh_stage, lambda: to_pandas(run_async(svc, Q_GAL)))
    print(f"stage 1: {len(gal)} rank-0 galaxy solutions pass the redshift cuts", flush=True)
    qual, m2 = stage("stage2_quality", 2 in a.refresh_stage, lambda: to_pandas(run_async(svc, Q_QUAL)))
    print(f"stage 2: {len(qual)} spectra pass the dither / pixel cuts", flush=True)
    g1 = gal.sort_values("spe_z_prob", ascending=False).drop_duplicates("object_id")
    q1 = qual.sort_values("spe_n_dith_med", ascending=False).drop_duplicates("object_id")
    gq = g1.merge(q1, on="object_id")
    print(f"stages 1+2: {len(gq)} objects", flush=True)

    # stage 3 (H-alpha scan) and stage 4 (MER join on the stage 1+2 ids, one upload) are independent
    # full-table scans on IRSA (no index on object_id: a single-id lookup took 73 s), so run both at once
    ids_all = np.sort(gq["object_id"].to_numpy(dtype=np.int64))

    def mer_stage():
        parts = []
        for k, lo in enumerate(range(0, len(ids_all), MER_CHUNK)):
            chunk = Table({"object_id": ids_all[lo:lo + MER_CHUNK]})
            part, _ = stage(f"stage4_mer_{k:03d}", 4 in a.refresh_stage,
                            lambda c=chunk: to_pandas(run_async(svc, Q_MER, uploads={"ids": c})))
            parts.append(part)
            print(f"  MER chunk {k}: {len(chunk)} ids -> {len(part)} rows", flush=True)
        return parts

    with cf.ThreadPoolExecutor(max_workers=2) as ex:
        f_ha = ex.submit(stage, "stage3_halpha", 3 in a.refresh_stage, lambda: to_pandas(run_async(svc, Q_HA)))
        f_mer = ex.submit(mer_stage)
        ha, m3 = f_ha.result()
        mer_parts = f_mer.result()
    print(f"stage 3: {len(ha)} rank-0 H-alpha lines pass the flux / S/N cuts", flush=True)

    # one row per object: object_id is "not guaranteed to be unique" (several tiles / products)
    n_dup = {"stage1": int(gal["object_id"].duplicated().sum()), "stage2": int(qual["object_id"].duplicated().sum()),
             "stage3": int(ha["object_id"].duplicated().sum())}
    h1 = ha.sort_values("ha_snr", ascending=False).drop_duplicates("object_id")
    spe = gq.merge(h1, on="object_id")
    print(f"SPE cuts together: {len(spe)} objects", flush=True)
    mer = pd.concat(mer_parts, ignore_index=True)
    n_dup["stage4_mer"] = int(mer["object_id"].duplicated().sum())
    m4 = {"chunks": len(mer_parts), "chunk_size": MER_CHUNK, "uploaded_ids": int(len(ids_all)), "rows": int(len(mer))}
    mer1 = mer.sort_values("kron_radius").drop_duplicates("object_id")
    df = spe.merge(mer1, on="object_id", how="inner")
    print(f"stage 4: {len(df)} objects after the MER cuts", flush=True)

    z = df["spe_z"].to_numpy(dtype=float)
    zerr = df["spe_z_err"].to_numpy(dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        he = -2.5 * np.log10(df["flux_h_templfit"].to_numpy(dtype=float)) + 23.9   # MER fluxes in microJansky (AB)
        ie = -2.5 * np.log10(df["flux_vis_to_h_templfit"].to_numpy(dtype=float)) + 23.9
    he[~np.isfinite(he)] = np.nan
    ie[~np.isfinite(ie)] = np.nan
    oid = df["object_id"].to_numpy(dtype=np.int64)
    if (oid < 0).any():
        raise SystemExit("negative object_id in the sample: the uint64 tile id would not round-trip; handle first")
    full = pd.DataFrame({
        "id": pd.Series([f"Euclid DR1 {o}" for o in oid], dtype="string"),
        "numeric_id": oid.astype(np.uint64),
        "ra": df["ra"].to_numpy(dtype=float), "dec": df["dec"].to_numpy(dtype=float),
        "dist_pc": comoving_pc(z),
        "dist_lo_pc": comoving_pc(np.clip(z - zerr, 0, None)),
        "dist_hi_pc": comoving_pc(z + zerr),
        "mag": he.astype(np.float32), "color": (ie - he).astype(np.float32),
        "kind": pd.Categorical(["galaxy"] * len(df), categories=["galaxy", "qso"]),
        "z": z, "zerr": zerr.astype(np.float32),
        "spe_z_prob": df["spe_z_prob"].to_numpy(dtype=np.float32),
        "spe_z_rel": df["spe_z_rel"].to_numpy(dtype=np.float32),
        "ha_flux": df["ha_flux"].to_numpy(dtype=np.float32),
        "ha_snr": df["ha_snr"].to_numpy(dtype=np.float32),
        "n_dith_med": df["spe_n_dith_med"].to_numpy(dtype=np.int16),
        "grism": pd.Categorical(df["spe_grism"].astype(str)),
        "tileid": df["tileid"].to_numpy(dtype=np.int64),
    })

    # de-duplication against the surveys already shown (keep those)
    refs = [("DESI DR1", RAW / "galaxies-desi" / "galaxies-desi.parquet"),
            ("SDSS DR17", RAW / "galaxies-sdss" / "parts" / "sdss_dr17_clean.parquet"),
            ("2MRS", RAW / "galaxies-2mrs" / "galaxies-2mrs.parquet"),
            ("6dFGS DR3", RAW / "galaxies-6dfgs" / "parts" / "6dfgs_clean.parquet"),
            ("2dFGRS", RAW / "galaxies-2dfgrs" / "parts" / "2dfgrs_clean.parquet")]
    keep = np.ones(len(full), bool)
    report = []
    for name, path in refs:
        t = pq.read_table(path, columns=["ra", "dec", "z"]).to_pandas()
        ref = RefCatalogue(name, t["ra"].to_numpy(), t["dec"].to_numpy(), t["z"].to_numpy())
        m = ref.match(full["ra"], full["dec"], full["z"], MATCH_ARCSEC, MATCH_DZ)
        s = summary(m, f"{name} ({ref.n} rows)", radius_arcsec=MATCH_ARCSEC, dz=MATCH_DZ)
        s["duplicates_not_already_removed"] = int((m["dup"] & keep).sum())
        report.append(s)
        full[f"dup_{name.split()[0].lower()}"] = m["dup"]
        keep &= ~m["dup"]
    pq.write_table(pa.Table.from_pandas(full, preserve_index=False), PARTS / "euclid_clean.parquet", compression="zstd")
    new = full[keep].reset_index(drop=True).drop(columns=[c for c in full.columns if c.startswith("dup_")])
    dest = OUT / "galaxies-euclid.parquet"
    pq.write_table(pa.Table.from_pandas(new, preserve_index=False), dest, compression="zstd")

    stats = {
        "stage1_galaxy_rows": int(len(gal)), "stage1": m1,
        "stage2_quality_rows": int(len(qual)), "stage2": m2,
        "stage3_halpha_rows": int(len(ha)), "stage3": m3,
        "spe_cuts_together": int(len(spe)),
        "stage4_mer_rows": int(len(mer)), "stage4": m4,
        "duplicate_object_id_rows_dropped": n_dup,
        "rows_after_cuts": int(len(full)),
        "grism": {k: int(v) for k, v in full["grism"].value_counts().items()},
        "dedup": report,
        "rows_final": int(len(new)),
        "z_hist_0.1_after_cuts": zhist(full["z"]),
        "zerr_median": float(np.nanmedian(full["zerr"])),
        "zerr_over_1pz_median": float(np.nanmedian(full["zerr"] / (1 + full["z"]))),
        "dec_range": [round(float(full["dec"].min()), 3), round(float(full["dec"].max()), 3)],
        "ra_range": [round(float(full["ra"].min()), 3), round(float(full["ra"].max()), 3)],
        "file": str(dest.relative_to(ROOT)), "file_bytes": dest.stat().st_size,
    }
    prov = {
        "layer": "galaxies-euclid",
        "release": "Euclid DR1-Foundation (public 2026-11-12); final DR1 (shear, LE3) follows in June 2027 and will "
                   "not reprocess these products (Aussel et al. 2026)",
        "service": TAP_URL,
        "tap_mode": MODE["tap"],
        "tables": [T_GAL, T_QUAL, T_LINE, T_MER],
        "query_stage1": Q_GAL, "query_stage2": Q_QUAL, "query_stage3": Q_HA,
        "query_stage4": Q_MER + f"\n-- TAP_UPLOAD.ids = object_ids passing stages 1-3, {MER_CHUNK} per request",
        "started_utc": started, "finished_utc": utcnow(),
        "selection": {"cuts": CUTS,
                      "source": "Le Brun et al. 2026 (Euclid DR1 SPE paper) sec. 4.3: 98.9 % agreement with DESI DR1 "
                                "for the 3863 such objects with a DESI counterpart, EDF-N",
                      "dedup": f"drop rows with a DESI DR1, SDSS DR17, 2MRS, 6dFGS or 2dFGRS object within "
                               f"{MATCH_ARCSEC} arcsec and |dz| < {MATCH_DZ}",
                      "not_included": "Euclid Wide Survey redshifts (<= 80 % correct even at high spe_z_prob per "
                                      "Le Brun et al. 2026) and all photometric redshifts; see docs/open-data-inventory.md"},
        "columns": {
            "ra/dec": "MER ra/dec (ICRS)", "z": "SPE rank-0 galaxy redshift spe_z", "dist_pc": "Planck18 comoving "
            "distance of z; lo/hi from spe_z -/+ spe_z_err", "mag": "HE (H band, MER TPHOT template-fit flux, AB)",
            "color": "IE - HE (VIS PSF-matched to H, TPHOT, AB)", "numeric_id": "MER object_id",
        },
        "stats": stats,
        "citations": CITATIONS,
        "licence": "\"All DR1 data is released under the CC BY-NC 3.0 IGO license\" (https://www.cosmos.esa.int/web/euclid/dr1-data)",
        "acknowledgement": ACK,
    }
    (OUT / "PROVENANCE.json").write_text(json.dumps(prov, indent=2, default=str))
    print(json.dumps(stats, indent=2, default=str))


if __name__ == "__main__":
    main()
