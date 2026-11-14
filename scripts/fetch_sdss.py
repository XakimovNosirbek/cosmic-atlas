#!/usr/bin/env python
"""Fetch SDSS DR17 optical spectroscopic galaxies + quasars -> data/raw/galaxies-sdss/, de-duplicated
against DESI DR1 (data/raw/galaxies-desi).

Access path: SDSS SkyServer DR17 SqlSearch (CSV). specObj is the sciencePrimary=1 view of
specObjAll (one best spectrum per object); it is LEFT JOINed with PhotoObjAll on bestObjID for
extinction-corrected model magnitudes. (NOIRLab Data Lab hosts sdss_dr17.specobj too, but its TAP
returned HTTP 502 on 2026-11-14; SkyServer answers in seconds.)

Stage 0: row counts per 1-degree RA bin (GROUP BY FLOOR(ra)), cached in parts/ra_counts.parquet.
Bins are grouped into contiguous RA ranges of ~--rows-per-job rows.
Stage 1 (resumable): one SkyServer query per RA range, <= 3 in parallel. A part lands in
parts/ra_<lo>_<hi>.parquet only if its row count equals the expected count (catches SkyServer's
row cap and truncated responses); existing parts are skipped on re-run.
Server-side cut: zWarning = 0 AND class IN ('GALAXY', 'QSO').

Stage 2: local cut z >= 0.003 (contract: no Hubble-flow distance below 0.003), derived columns,
then the DESI cross-match: an SDSS object is a duplicate when a DESI DR1 object lies within 1 arcsec
AND |z_SDSS - z_DESI| < 0.002; DESI is kept. For SDSS quasars the redshift tolerance is
max(0.002, 0.005 (1+z)) (--qso-dz-1pz; 0 = strict): two pipelines' QSO redshifts differ by hundreds
of km/s, and a 1" QSO pair is the same quasar (the chance baseline, positions moved 1' north, gives
785 position matches against 1,089,331 real ones). Both the strict and the shipped counts go to
PROVENANCE.json. The layer file holds only the SDSS objects that are not duplicates. The full cleaned SDSS table stays in parts/sdss_dr17_clean.parquet (outside the layer
glob) for the de-duplication of the later surveys (scripts/fetch_6df_2df.py).

Usage: .venv/bin/python scripts/fetch_sdss.py [--rows-per-job 120000] [--workers 3] [--only-combine]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import io
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coords import comoving_pc  # noqa: E402
from xmatch import RefCatalogue, summary  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "raw" / "galaxies-sdss"
PARTS = OUT / "parts"
DESI = ROOT / "data" / "raw" / "galaxies-desi" / "galaxies-desi.parquet"
SQL_URL = "https://skyserver.sdss.org/dr17/SkyServerWS/SearchTools/SqlSearch"
UA = {"User-Agent": "cosmic-atlas-fetch/1.0 (research visualisation; python-requests)"}
Z_MIN = 0.003
MATCH_ARCSEC = 1.0
MATCH_DZ = 0.002
QSO_DZ_1PZ = 0.005  # ~1500 km/s, see stage2

WHERE = "s.zWarning = 0 AND s.class IN ('GALAXY','QSO')"
QUERY = f"""SELECT s.specObjID, s.bestObjID, s.ra, s.dec, s.z, s.zErr, s.zWarning, s.class, s.subClass,
 s.survey, s.programname, s.plate, s.mjd, s.fiberID, s.spectroFlux_g, s.spectroFlux_r, p.dered_g, p.dered_r
FROM specObj AS s LEFT OUTER JOIN PhotoObjAll AS p ON p.objID = s.bestObjID
WHERE {WHERE} AND s.ra >= {{lo}} AND s.ra < {{hi}}"""
BIN_QUERY = f"SELECT FLOOR(s.ra) AS rbin, COUNT(*) AS n FROM specObj AS s WHERE {WHERE} GROUP BY FLOOR(s.ra)"
COUNT_QUERY = f"SELECT s.class, COUNT(*) AS n FROM specObj AS s WHERE {WHERE} GROUP BY s.class"

CITATIONS = [
    {"what": "SDSS DR17", "ref": "Abdurro'uf et al. 2022, ApJS 259, 35", "doi": "10.3847/1538-4365/ac4414"},
    {"what": "SDSS-I/II spectroscopy (Legacy)", "ref": "Strauss et al. 2002, AJ 124, 1810; Eisenstein et al. 2001, AJ 122, 2267",
     "doi": "10.1086/342343"},
    {"what": "BOSS", "ref": "Dawson et al. 2013, AJ 145, 10", "doi": "10.1088/0004-6256/145/1/10"},
    {"what": "eBOSS", "ref": "Dawson et al. 2016, AJ 151, 44", "doi": "10.3847/0004-6256/151/2/44"},
    {"what": "SDSS spectroscopic pipeline (zWarning, class)", "ref": "Bolton et al. 2012, AJ 144, 144",
     "doi": "10.1088/0004-6256/144/5/144"},
    {"what": "Planck 2018 cosmology (distances)", "ref": "Planck Collaboration 2020, A&A 641, A6",
     "doi": "10.1051/0004-6361/201833910"},
]
ACK = ("Funding for the Sloan Digital Sky Survey IV has been provided by the Alfred P. Sloan Foundation, the U.S. "
       "Department of Energy Office of Science, and the Participating Institutions. SDSS acknowledges support and "
       "resources from the Center for High-Performance Computing at the University of Utah. The SDSS web site is "
       "www.sdss4.org. (Full acknowledgement: https://www.sdss4.org/collaboration/citing-sdss/)")


def utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sql(cmd: str, timeout: int = 600) -> pd.DataFrame:
    r = requests.get(SQL_URL, params={"cmd": cmd, "format": "csv"}, headers=UA, timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
    txt = r.text
    if not txt.startswith("#Table1"):
        raise RuntimeError(f"unexpected response: {txt[:300]}")
    body = txt.split("\n", 1)[1]
    # specObjID / bestObjID exceed int64 for eBOSS plates: read ids as uint64
    return pd.read_csv(io.StringIO(body), dtype={"specObjID": "uint64", "bestObjID": "uint64",
                                                 "class": str, "subClass": str, "survey": str, "programname": str},
                       keep_default_na=True)


def part_path(lo: int, hi: int) -> Path:
    return PARTS / f"ra_{lo:03d}_{hi:03d}.parquet"


def bin_counts() -> pd.DataFrame:
    cache = PARTS / "ra_counts.parquet"
    if cache.exists():
        return pd.read_parquet(cache)
    df = sql(BIN_QUERY)
    df = df.astype({"rbin": int, "n": np.int64}).sort_values("rbin").reset_index(drop=True)
    df.to_parquet(cache, index=False)
    return df


def make_blocks(counts: pd.DataFrame, rows_per_job: int) -> list[tuple[int, int, int]]:
    """Contiguous RA ranges [lo, hi) of whole degrees with ~rows_per_job rows each."""
    blocks, lo, acc = [], None, 0
    for b, n in zip(counts["rbin"].to_numpy(), counts["n"].to_numpy()):
        if lo is None:
            lo = int(b)
        acc += int(n)
        if acc >= rows_per_job:
            blocks.append((lo, int(b) + 1, acc))
            lo, acc = None, 0
    if lo is not None:
        blocks.append((lo, int(counts["rbin"].iloc[-1]) + 1, acc))
    return blocks


def fetch_block(lo: int, hi: int, expected: int, retries: int = 5) -> tuple[int, int, int, float]:
    dest = part_path(lo, hi)
    if dest.exists():
        return lo, hi, pq.read_metadata(dest).num_rows, 0.0
    delay = 20.0
    for attempt in range(1, retries + 1):
        t0 = time.time()
        try:
            df = sql(QUERY.format(lo=lo, hi=hi))
            if len(df) != expected:
                raise RuntimeError(f"row count {len(df)} != expected {expected}")
            tmp = dest.with_suffix(".tmp")
            df.to_parquet(tmp, index=False)
            tmp.rename(dest)
            return lo, hi, len(df), time.time() - t0
        except Exception as exc:
            print(f"  block {lo}-{hi} attempt {attempt} failed: {exc}", flush=True)
            if attempt == retries:
                raise
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")


def stage1(rows_per_job: int, workers: int) -> dict:
    PARTS.mkdir(parents=True, exist_ok=True)
    counts = bin_counts()
    blocks = make_blocks(counts, rows_per_job)
    names = {part_path(lo, hi).name for lo, hi, _ in blocks}
    stray = [f for f in PARTS.glob("ra_*_*.parquet") if f.name not in names]
    if stray:
        raise SystemExit(f"{len(stray)} parts do not match the current blocking; delete {PARTS} or keep --rows-per-job")
    todo = [b for b in blocks if not part_path(b[0], b[1]).exists()]
    print(f"stage 1: {int(counts['n'].sum())} rows in {len(counts)} RA bins -> {len(blocks)} blocks, "
          f"{len(todo)} to fetch", flush=True)
    done = 0
    with cf.ThreadPoolExecutor(max_workers=min(workers, 3)) as ex:
        futs = {ex.submit(fetch_block, lo, hi, n): (lo, hi) for lo, hi, n in todo}
        for f in cf.as_completed(futs):
            lo, hi, n, secs = f.result()
            done += 1
            print(f"  [{done}/{len(todo)}] ra {lo}-{hi}: {n} rows in {secs:.0f}s", flush=True)
    return {"blocks": len(blocks), "rows_per_job_target": rows_per_job, "ra_bins": int(len(counts)),
            "bin_count_query": BIN_QUERY}


def mag_from_nmgy(flux) -> np.ndarray:
    f = np.asarray(flux, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        m = 22.5 - 2.5 * np.log10(f)
    m[~np.isfinite(m) | (f <= 0)] = np.nan
    return m


def zhist(z) -> dict:
    edges = np.round(np.arange(0, 7.01, 0.1), 1)
    h, _ = np.histogram(z, bins=edges)
    return {f"{edges[i]:.1f}-{edges[i+1]:.1f}": int(h[i]) for i in range(len(h)) if h[i]}


def stage2(server_counts: dict | None, qso_dz_1pz: float = 0.005) -> dict:
    files = sorted(PARTS.glob("ra_*_*.parquet"))
    df = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    n_fetched = len(df)
    by_class_fetched = {k: int(v) for k, v in df["class"].value_counts().items()}
    dup_ids = int(df["specObjID"].duplicated().sum())
    df = df.drop_duplicates("specObjID")
    cuts = {}
    lowz = df["z"].to_numpy() < Z_MIN
    cuts["z_lt_0.003_removed"] = {k: int(v) for k, v in df.loc[lowz, "class"].value_counts().items()}
    df = df[~lowz].reset_index(drop=True)

    z = df["z"].to_numpy(dtype=float)
    zerr = df["zErr"].to_numpy(dtype=float)
    r = df["dered_r"].to_numpy(dtype=float)
    g = df["dered_g"].to_numpy(dtype=float)
    bad = ~np.isfinite(r) | (r <= 0) | (r > 40)  # PhotoObj sentinels (-9999) or no photometry row
    r_spec, g_spec = mag_from_nmgy(df["spectroFlux_r"]), mag_from_nmgy(df["spectroFlux_g"])
    cuts["mag_from_spectroFlux_no_photometry"] = int(bad.sum())
    r = np.where(bad, r_spec, r)
    g = np.where(bad | ~np.isfinite(g) | (g <= 0) | (g > 40), np.where(bad, g_spec, np.nan), g)
    cls = df["class"].astype(str).str.strip().to_numpy()
    kind = np.where(cls == "QSO", "qso", "galaxy")
    spec_id = df["specObjID"].to_numpy(dtype=np.uint64)
    full = pd.DataFrame({
        "id": pd.Series([f"SDSS DR17 specObjID {s}" for s in spec_id], dtype="string"),
        "numeric_id": spec_id,
        "best_obj_id": df["bestObjID"].to_numpy(dtype=np.uint64),
        "ra": df["ra"].to_numpy(dtype=float),
        "dec": df["dec"].to_numpy(dtype=float),
        "dist_pc": comoving_pc(z),
        "dist_lo_pc": comoving_pc(np.clip(z - zerr, 0, None)),
        "dist_hi_pc": comoving_pc(z + zerr),
        "mag": r.astype(np.float32),
        "color": (g - r).astype(np.float32),
        "kind": pd.Categorical(kind, categories=["galaxy", "qso"]),
        "z": z,
        "zerr": zerr.astype(np.float32),
        "class": pd.Categorical(cls),
        "subclass": pd.Categorical(df["subClass"].fillna("").astype(str).str.strip()),
        "survey": pd.Categorical(df["survey"].astype(str).str.strip()),
        "program": pd.Categorical(df["programname"].astype(str).str.strip()),
        "plate": df["plate"].to_numpy(dtype=np.int32),
        "mjd": df["mjd"].to_numpy(dtype=np.int32),
        "fiber": df["fiberID"].to_numpy(dtype=np.int16),
    })

    # --- de-duplication against DESI DR1 (keep DESI)
    t0 = time.time()
    d = pq.read_table(DESI, columns=["ra", "dec", "z"]).to_pandas()
    ref = RefCatalogue("DESI DR1", d["ra"].to_numpy(), d["dec"].to_numpy(), d["z"].to_numpy())
    m = ref.match(full["ra"], full["dec"], full["z"], MATCH_ARCSEC, MATCH_DZ)
    dedup = summary(m, "DESI DR1 (data/raw/galaxies-desi, %d rows)" % ref.n, kind=full["kind"].astype(str),
                    radius_arcsec=MATCH_ARCSEC, dz=MATCH_DZ)
    # chance alignments: the same match with every SDSS position moved 1 arcmin north
    mc = ref.match(full["ra"], np.clip(full["dec"].to_numpy() + 1 / 60, -90, 90), full["z"], MATCH_ARCSEC, MATCH_DZ)
    dedup["chance_baseline_dec_plus_1arcmin"] = {"position_matches": int(mc["pos"].sum()), "duplicates": int(mc["dup"].sum())}
    is_qso = full["kind"].astype(str).to_numpy() == "qso"
    if qso_dz_1pz > 0:
        # quasar redshifts from two pipelines differ by a few hundred to ~1000 km/s (broad, shifted lines);
        # a 1" pair of QSOs is the same quasar (chance baseline above), so QSOs use |dz| < qso_dz_1pz (1+z)
        tol = np.where(is_qso, np.maximum(MATCH_DZ, qso_dz_1pz * (1 + full["z"].to_numpy())), MATCH_DZ)
        m2 = ref.match(full["ra"], full["dec"], full["z"], MATCH_ARCSEC, tol)
        ext = summary(m2, dedup["reference"], kind=full["kind"].astype(str), radius_arcsec=MATCH_ARCSEC, dz=tol)
        ext["criterion"] = (f"separation <= {MATCH_ARCSEC} arcsec AND |dz| < {MATCH_DZ} (galaxies) or "
                            f"|dz| < max({MATCH_DZ}, {qso_dz_1pz} (1+z)) (SDSS class QSO)")
        dedup["shipped_rule_qso_tolerance"] = ext
        dedup["new_objects_strict_rule"] = int((~m["dup"]).sum())
        dedup["new_objects_shipped_rule"] = int((~m2["dup"]).sum())
        m_strict, m = m, m2
    else:
        m_strict = m
    dedup["seconds"] = round(time.time() - t0, 1)
    del ref, d
    full["in_desi"] = m["dup"]
    full["in_desi_strict"] = m_strict["dup"]
    full["desi_pos_match_z_conflict"] = m["pos"] & ~m["dup"]
    clean = PARTS / "sdss_dr17_clean.parquet"
    pq.write_table(pa.Table.from_pandas(full, preserve_index=False), clean, compression="zstd")

    new = full[~m["dup"]].reset_index(drop=True)
    dest = OUT / "galaxies-sdss.parquet"
    pq.write_table(pa.Table.from_pandas(new, preserve_index=False), dest, compression="zstd", row_group_size=1_000_000)

    mt = sorted(f.stat().st_mtime for f in files)
    iso = lambda t: dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "parts": len(files),
        "parts_written_utc": [iso(mt[0]), iso(mt[-1])],
        "rows_fetched": n_fetched,
        "rows_fetched_by_class": by_class_fetched,
        "duplicate_specobjids_dropped": dup_ids,
        "rows_after_cuts": len(full),
        "rows_after_cuts_by_kind": {k: int(v) for k, v in full["kind"].value_counts().items()},
        "dedup_vs_desi": dedup,
        "rows_final_new_vs_desi": len(new),
        "rows_final_by_kind": {k: int(v) for k, v in new["kind"].value_counts().items()},
        "mag_r_available": int(np.isfinite(new["mag"]).sum()),
        "z_hist_0.1_all_good": zhist(full["z"]),
        "z_hist_0.1_final": zhist(new["z"]),
        "cuts": cuts,
        "server_counts_zwarning0": server_counts,
        "file": str(dest.relative_to(ROOT)),
        "file_bytes": dest.stat().st_size,
        "clean_full_table": str(clean.relative_to(ROOT)),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows-per-job", type=int, default=120_000)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--only-combine", action="store_true")
    ap.add_argument("--qso-dz-1pz", type=float, default=QSO_DZ_1PZ,
                    help="QSO redshift tolerance in units of (1+z) for the DESI match; 0 = the strict |dz| < 0.002 for all")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    started = utcnow()
    if a.only_combine:
        counts = pd.read_parquet(PARTS / "ra_counts.parquet")
        part_info = {"blocks": len(list(PARTS.glob("ra_*_*.parquet"))), "rows_per_job_target": a.rows_per_job,
                     "ra_bins": int(len(counts)), "bin_count_query": BIN_QUERY}
    else:
        part_info = stage1(a.rows_per_job, a.workers)
    try:
        sc = sql(COUNT_QUERY)
        counts = {str(c).strip(): int(n) for c, n in zip(sc["class"], sc["n"])}
    except Exception as exc:
        print("server count failed:", exc)
        counts = None
    stats = stage2(counts, a.qso_dz_1pz)
    if counts:
        expected = sum(counts.values())
        stats["completeness_check"] = {"server_rows": expected, "fetched_rows": stats["rows_fetched"],
                                       "ok": expected == stats["rows_fetched"]}
    prov = {
        "layer": "galaxies-sdss",
        "service": SQL_URL,
        "tables": ["specObj (= specObjAll WHERE sciencePrimary = 1)", "PhotoObjAll"],
        "query_template": QUERY,
        "partitioning": {"column": "FLOOR(specObj.ra), whole degrees", **part_info},
        "count_query": COUNT_QUERY,
        "started_utc": started,
        "finished_utc": utcnow(),
        "selection": {
            "server": "specObj (sciencePrimary = 1), zWarning = 0 (no pipeline warning), class GALAXY or QSO",
            "local": [f"drop z < {Z_MIN} (contract: no Hubble-flow distance below 0.003)",
                      f"drop SDSS objects duplicated in DESI DR1: DESI object within {MATCH_ARCSEC} arcsec AND "
                      f"|z_SDSS - z_DESI| < {MATCH_DZ}; the DESI entry is kept",
                      (f"SDSS QSOs: |dz| < max({MATCH_DZ}, {a.qso_dz_1pz} (1+z)) instead (deviation from the strict rule: "
                       "151,093 SDSS QSOs sit within 1 arcsec of a DESI object while the chance baseline is 785, "
                       "and 93 % of them agree to |dz|/(1+z) < 0.005; QSO redshifts from two pipelines differ by "
                       "hundreds of km/s). Both counts are in stats.dedup_vs_desi; --qso-dz-1pz 0 restores the strict rule")
                      if a.qso_dz_1pz > 0 else "strict rule for QSOs too (--qso-dz-1pz 0)"],
            "kept_on_purpose": "position matches whose redshifts still disagree are kept (not duplicates by the "
                               "criterion: mostly a catastrophic redshift in one survey); flagged desi_pos_match_z_conflict",
        },
        "columns": {
            "ra/dec": "specObj ra/dec (fibre position, J2000 / ICRS)",
            "dist_pc": "Planck18 comoving distance of z (scripts/coords.py)",
            "dist_lo_pc/dist_hi_pc": "comoving distance of z -/+ zErr",
            "mag": "PhotoObjAll dered_r (model magnitude, extinction corrected; SDSS asinh mags ~ AB); "
                   "if no photometry: 22.5 - 2.5 log10(spectroFlux_r) (nanomaggies, not extinction corrected)",
            "color": "dered_g - dered_r (same fallback)",
            "kind": "galaxy (class GALAXY) or qso (class QSO)",
            "numeric_id": "specObjID (uint64)",
        },
        "stats": stats,
        "citations": CITATIONS,
        "licence": "SDSS: \"All SDSS data released in our public data releases are considered in the public domain\" "
                   "(https://www.sdss.org/collaboration/); acknowledgement requested",
        "acknowledgement": ACK,
    }
    (OUT / "PROVENANCE.json").write_text(json.dumps(prov, indent=2))
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
