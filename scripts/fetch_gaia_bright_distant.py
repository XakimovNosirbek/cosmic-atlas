#!/usr/bin/env python3
"""
Fetch luminous Gaia DR3 stars between 1 kpc and 10 kpc to extend the Milky Way's real-star
coverage past the 1 kpc local volume (arms, OB associations, bright giants, supergiants).

Run it on a machine with a fast link (12 TAP queries, one per 30-degree slice of Galactic
longitude). Writes a contract-format Parquet file directly consumable by
`pipeline/build_tiles.py` (docs/data-contract.md).

Selection:
  - Bailer-Jones et al. (2021, AJ 161, 147) photogeometric distance: 1000 < r_med_photogeo <= 10000 pc
  - Quality: ruwe < 1.4, parallax / parallax_error > 5, distance fractional uncertainty < 0.25
  - Intrinsic luminosity: M_G = G - 5 log10(r/10) < -0.5 (OB stars, red/yellow giants & supergiants)
  - Valid BP-RP colour for physical blackbody tinting

Usage:
  python scripts/fetch_gaia_bright_distant.py --out data/raw/gaia_1_10kpc.parquet
  python pipeline/build_tiles.py --input data/raw/gaia_1_10kpc.parquet \\
      --out data/tiles/stars-gaia-distant --layer stars-gaia-distant --mode star
"""

from __future__ import annotations

import argparse
import io
import sys
import time
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.csv as pacsv
import pyarrow.parquet as pq
import requests

TAP_URL = "https://gea.esac.esa.int/tap-server/tap/sync"

# Partitioned by Galactic longitude l in 30-degree slices so each synchronous TAP query finishes
# well inside ESA's timeout and is cleanly resumable.
ADQL_TEMPLATE = """
SELECT
    g.source_id,
    g.ra, g.dec,
    g.phot_g_mean_mag AS mag,
    g.bp_rp AS color,
    bj.r_med_photogeo AS dist_pc,
    bj.r_lo_photogeo AS dist_lo_pc,
    bj.r_hi_photogeo AS dist_hi_pc,
    g.pmra, g.pmdec, g.radial_velocity
FROM gaiadr3.gaia_source AS g
JOIN external.gaiaedr3_distance AS bj
  ON g.source_id = bj.source_id
WHERE g.l >= {l0} AND g.l < {l1}
  AND bj.r_med_photogeo > 1000.0
  AND bj.r_med_photogeo <= 10000.0
  AND (bj.r_hi_photogeo - bj.r_lo_photogeo) / (2.0 * bj.r_med_photogeo) < 0.25
  AND g.parallax_over_error > 5.0
  AND g.ruwe < 1.4
  AND g.bp_rp IS NOT NULL
  AND g.phot_g_mean_mag - 5.0 * LOG10(bj.r_med_photogeo / 10.0) < {mg_max}
"""


def fetch_slice(l0: int, l1: int, mg_max: float, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  [skip] {dest.name} already exists ({dest.stat().st_size / 1e6:.1f} MB)")
        return dest
    adql = ADQL_TEMPLATE.format(l0=l0, l1=l1, mg_max=mg_max)
    for attempt in range(1, 4):
        try:
            r = requests.post(
                TAP_URL,
                data={"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": adql},
                timeout=300,
            )
            r.raise_for_status()
            # the ESA archive has no Parquet output (FORMAT=parquet silently returns VOTable): read CSV
            tbl = pacsv.read_csv(io.BytesIO(r.content))
            tmp = dest.with_suffix(".tmp")
            pq.write_table(tbl, tmp)
            tmp.replace(dest)
            print(f"  [ok] l=[{l0:3d},{l1:3d}) -> {tbl.num_rows:,} stars ({dest.stat().st_size / 1e6:.1f} MB)")
            return dest
        except Exception as exc:
            print(f"  [warn] attempt {attempt}/3 failed for l=[{l0},{l1}): {exc}", file=sys.stderr)
            time.sleep(5 * attempt)
    raise RuntimeError(f"Failed to download slice l=[{l0},{l1})")


def merge_slices(slices: list[Path], out: Path) -> None:
    tables = [pq.read_table(p) for p in slices if p.exists()]
    combined = pa.concat_tables(tables, promote_options="default")
    # Convert to float64 / int64 contract schema and drop non-finite rows
    dist = combined["dist_pc"].to_numpy().astype(np.float64)
    mag = combined["mag"].to_numpy().astype(np.float64)
    color = combined["color"].to_numpy().astype(np.float64)
    ok = np.isfinite(dist) & (dist > 1000.0) & np.isfinite(mag) & np.isfinite(color)
    filtered = combined.filter(pa.array(ok))
    out.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(filtered, out, compression="zstd")
    print(f"Wrote {filtered.num_rows:,} stars to {out} ({out.stat().st_size / 1e6:.1f} MB)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch luminous Gaia DR3 stars (1-10 kpc) via ESA TAP")
    ap.add_argument("--out", type=Path, default=Path("data/raw/gaia_1_10kpc.parquet"))
    ap.add_argument("--slices-dir", type=Path, default=Path("data/raw/gaia_1_10kpc_slices"))
    ap.add_argument("--step-deg", type=int, default=30, help="Galactic longitude slice width (deg)")
    ap.add_argument("--mg-max", type=float, default=-0.5, help="Max absolute G magnitude M_G")
    args = ap.parse_args()

    args.slices_dir.mkdir(parents=True, exist_ok=True)
    slices: list[Path] = []
    for l0 in range(0, 360, args.step_deg):
        l1 = min(360, l0 + args.step_deg)
        slices.append(fetch_slice(l0, l1, args.mg_max, args.slices_dir / f"l_{l0:03d}_{l1:03d}.parquet"))
    merge_slices(slices, args.out)


if __name__ == "__main__":
    main()
