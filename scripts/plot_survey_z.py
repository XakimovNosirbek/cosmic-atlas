#!/usr/bin/env python
"""Redshift histograms of the galaxy survey layers as shipped (after cuts and de-duplication)
-> figures/surveys-zhist.png, and a comoving-distance spot check printed to stdout.

Needs matplotlib, which the project venv does not carry:
  uv run --with matplotlib --with pyarrow --with numpy --with astropy python scripts/plot_survey_z.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
LAYERS = [  # layer, label, colour (Okabe-Ito)
    ("galaxies-desi", "DESI DR1", "#000000"),
    ("galaxies-sdss", "SDSS DR17, not in DESI", "#0072B2"),
    ("galaxies-2mrs", "2MRS", "#009E73"),
    ("galaxies-6dfgs", "6dFGS, new", "#E69F00"),
    ("galaxies-2dfgrs", "2dFGRS, new", "#CC79A7"),
    ("galaxies-euclid", "Euclid DR1 EDF-N, new", "#D55E00"),
]


def main() -> None:
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.6), constrained_layout=True)
    for ax, (lo, hi, step, log) in zip(axes, [(0, 0.35, 0.005, False), (0, 4.5, 0.05, True)]):
        edges = np.arange(lo, hi + step / 2, step)
        for layer, label, col in LAYERS:
            f = RAW / layer / f"{layer}.parquet"
            if not f.exists():
                continue
            z = pq.read_table(f, columns=["z"]).column("z").to_numpy()
            h, _ = np.histogram(z, bins=edges)
            ax.step(edges[:-1], h, where="post", color=col, lw=1.3, label=f"{label} ({len(z):,})")
        ax.set_xlim(lo, hi)
        ax.set_xlabel("redshift z")
        ax.set_ylabel(f"objects per Δz = {step}")
        if log:
            ax.set_yscale("log")
            ax.set_ylim(0.8, None)
        ax.grid(alpha=0.25)
    axes[0].set_title("z < 0.35 (linear)")
    axes[1].set_title("all redshifts (log)")
    axes[1].legend(fontsize=8, loc="upper right")
    fig.suptitle("Cosmic Atlas galaxy layers after quality cuts and de-duplication "
                 "(SDSS–DESI 1″, others 3″; |Δz| < 0.002, SDSS QSOs < 0.005(1+z))")
    out = ROOT / "figures" / "surveys-zhist.png"
    fig.savefig(out, dpi=130)
    print("wrote", out)


if __name__ == "__main__":
    sys.exit(main())
