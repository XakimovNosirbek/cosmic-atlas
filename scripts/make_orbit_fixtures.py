#!/usr/bin/env python3
"""Reference orbits from galpy for the viewer's Galactic-orbit code (web/src/orbits/).

Writes web/test/fixtures/orbits/galpy_mw2014.json, which web/test/orbits.test.ts compares against
and tests/test_orbit_fixtures.py checks for internal consistency. galpy is needed only to (re)make
the file: `uv pip install --python .venv/bin/python galpy`.

What is in it:
  * potential: galpy MWPotential2014 (ro = 8 kpc, vo = 220 km/s) circular speed, forces and
    potential at a few (R, z), in the viewer's units (km/s, km/s per Myr, (km/s)^2)
  * frame: the contract's heliocentric Galactic frame -> Galactocentric, checked against astropy
    Galactocentric (galcen at l = b = 0, R0 = 8275 pc, z_sun = 20.8 pc, Schoenrich 2010 + vc(R0))
  * orbits: the Sun and 5 Gaia DR3 stars (Gliese 710, Barnard's Star, 3 from the 100 pc preview
    layer: a fast halo-like star, a large-|W| star, a typical disc star) integrated with galpy
    (dop853_c, rtol 1e-12) to -100 ... +100 Myr; positions every 5 Myr, energy and Lz
  * gl710: closest approach to the Sun on both galpy orbits (0 ... 3 Myr, 10 yr sampling)
  * sun: azimuthal period from a 2 Gyr galpy orbit

Usage: .venv/bin/python scripts/make_orbit_fixtures.py [--tiles data/tiles/stars-gaia-preview]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "pipeline"))
import build_tiles as bt  # noqa: E402

OUT = REPO / "web" / "test" / "fixtures" / "orbits" / "galpy_mw2014.json"
GAIA_FIX = REPO / "tests" / "fixtures" / "gaia_dr3_gj710_barnard.json"

K = 1.022712165045695  # pc per (km/s Myr)
RO_KPC, VO = 8.0, 220.0
R0_PC, ZSUN_PC = 8275.0, 20.8
UVW = np.array([11.1, 12.24, 7.25])  # Schoenrich, Binney & Dehnen 2010


def frame_H():
    s = ZSUN_PC / R0_PC
    c = np.sqrt(1 - s * s)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def helio_to_gc(p, v, vsun):
    H = frame_H()
    x = H @ (np.asarray(p) - np.array([R0_PC, 0, 0]))
    return x, H @ np.asarray(v) + vsun


def to_galpy(x, v):
    """right-handed Galactocentric (Sun at -x, rotation +y), pc & km/s -> galpy [R, vR, vT, z, vz, phi] natural"""
    R = np.hypot(x[0], x[1])
    vR = (x[0] * v[0] + x[1] * v[1]) / R
    vT = (-x[0] * v[1] + x[1] * v[0]) / R
    phi = np.arctan2(x[1], -x[0])
    ro = RO_KPC * 1000
    return [R / ro, vR / VO, vT / VO, x[2] / ro, v[2] / VO, phi]


def from_galpy(R, z, phi):
    """galpy (kpc, rad) -> right-handed Galactocentric pc"""
    return np.stack([-R * np.cos(phi) * 1000, R * np.sin(phi) * 1000, z * 1000], -1)


def read_preview(tiles: Path):
    meta = json.loads((tiles / "meta.json").read_text())
    rows = []
    for nd in meta["nodes"]:
        n = nd["count"]
        rec = np.fromfile(tiles / "n" / f"{nd['name']}.bin", dtype=np.uint8).reshape(n, 16)
        xyz = rec[:, :12].copy().view("<f4").reshape(n, 3).astype(np.float64) + np.array(nd["center"])
        vel = np.fromfile(tiles / "n" / f"{nd['name']}.vel.bin", dtype="<f2").reshape(n, 4).astype(np.float64)
        ext = np.fromfile(tiles / "n" / f"{nd['name']}.ext.bin", dtype=np.uint8).reshape(n, meta["extBytesPerPoint"])
        ids = ext[:, :8].copy().view("<u8").ravel()
        mag = ext[:, 8:12].copy().view("<f4").ravel()
        for i in range(n):
            if vel[i, 3] == 1:
                rows.append((int(ids[i]), xyz[i], vel[i, :3], float(mag[i])))
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", default=str(REPO / "data" / "tiles" / "stars-gaia-preview"))
    a = ap.parse_args(argv)

    import astropy.units as u
    from astropy.coordinates import CartesianDifferential, CartesianRepresentation, Galactic, Galactocentric, SkyCoord
    from galpy.orbit import Orbit
    from galpy.potential import MWPotential2014, evaluatePotentials, evaluateRforces, evaluatezforces, vcirc
    from galpy.util import conversion
    import galpy

    tu_myr = conversion.time_in_Gyr(VO, RO_KPC) * 1000.0  # Myr per natural time unit
    vc_sun = vcirc(MWPotential2014, np.sqrt(R0_PC**2 - ZSUN_PC**2) / 1000 / RO_KPC) * VO
    vsun = np.array([UVW[0], vc_sun + UVW[1], UVW[2]])

    # ---- potential samples (galpy natural -> viewer units)
    pot_pts = [[2000, 0], [5000, 0], [8000, 0], [8274.97, 20.8], [8275, 500], [12000, -300], [20000, 2000], [500, 100]]
    pot = []
    for R, z in pot_pts:
        Rn, zn = R / 1000 / RO_KPC, z / 1000 / RO_KPC
        fR = evaluateRforces(MWPotential2014, Rn, zn) * VO**2 / (RO_KPC * 1000) * K
        fz = evaluatezforces(MWPotential2014, Rn, zn) * VO**2 / (RO_KPC * 1000) * K
        pot.append({"R": R, "z": z, "vc": float(vcirc(MWPotential2014, Rn) * VO) if z == 0 else None,
                    "aR": float(fR), "az": float(fz), "phi": float(evaluatePotentials(MWPotential2014, Rn, zn) * VO**2)})

    # ---- stars
    gaia = json.loads(GAIA_FIX.read_text())["stars"]
    stars = []
    for s in gaia:
        p = bt.radec_dist_to_galactic_xyz([s["ra"]], [s["dec"]], [s["r_med_geo"]])[0]
        v, _ = bt.space_velocity_galactic([s["ra"]], [s["dec"]], [s["r_med_geo"]], [s["pmra"]], [s["pmdec"]], [s["radial_velocity"]])
        stars.append({"name": s["name"], "source_id": str(s["source_id"]), "p": p.tolist(), "v": v[0].tolist(), "from": "Gaia DR3 astrometry (tests/fixtures)"})
    rows = read_preview(Path(a.tiles))
    speed = np.array([np.linalg.norm(r[2]) for r in rows])
    w = np.array([abs(r[2][2]) for r in rows])
    mag = np.array([r[3] for r in rows])
    picks = [("fast (halo-like)", int(np.argmax(speed))), ("large |W|", int(np.argmax(np.where(speed < 150, w, 0))))]
    typical = np.where((speed > 15) & (speed < 35) & (mag < 9))[0]
    picks.append(("typical disc", int(typical[np.argmin(mag[typical])])))
    for label, i in picks:
        sid, p, v, _m = rows[i]
        stars.append({"name": f"Gaia DR3 {sid} ({label})", "source_id": str(sid), "p": p.tolist(), "v": v.tolist(), "from": "stars-gaia-preview tiles (float32 xyz, float16 v)"})

    # ---- frame check against astropy (galcen exactly at l = b = 0)
    gc_dir = SkyCoord(l=0 * u.deg, b=0 * u.deg, frame="galactic").icrs
    gcf = Galactocentric(galcen_distance=R0_PC * u.pc, z_sun=ZSUN_PC * u.pc, galcen_v_sun=CartesianDifferential(vsun * u.km / u.s),
                         galcen_coord=gc_dir, roll=0 * u.deg)
    frame_rows = []
    for s in stars:
        p, v = np.array(s["p"]), np.array(s["v"])
        rep = CartesianRepresentation(p * u.pc, differentials=CartesianDifferential(v * u.km / u.s))
        c = SkyCoord(Galactic(rep)).transform_to(gcf)
        ax = c.cartesian.xyz.to(u.pc).value
        av = c.velocity.d_xyz.to(u.km / u.s).value
        mx, mv = helio_to_gc(p, v, vsun)
        frame_rows.append({"name": s["name"], "astropy_x": ax.tolist(), "astropy_v": av.tolist(),
                           "dx_pc": float(np.linalg.norm(ax - mx)), "dv_kms": float(np.linalg.norm(av - mv))})

    # ---- orbits
    ts = np.arange(0, 100.0 + 1e-9, 5.0)
    bodies = [{"name": "Sun", "p": [0.0, 0.0, 0.0], "v": [0.0, 0.0, 0.0]}] + stars
    for b in bodies:
        x, v = helio_to_gc(b["p"], b["v"], vsun)
        b["gc_x"], b["gc_v"] = x.tolist(), v.tolist()
        for sign, key in ((1, "future"), (-1, "past")):
            o = Orbit(to_galpy(x, v), ro=RO_KPC, vo=VO)
            o.turn_physical_off()
            tn = sign * ts / tu_myr
            o.integrate(tn, MWPotential2014, method="dop853_c", rtol=1e-12, atol=1e-14, progressbar=False)
            R, z, phi = o.R(tn) * RO_KPC, o.z(tn) * RO_KPC, o.phi(tn)
            phi = np.unwrap(phi)
            E = o.E(tn, pot=MWPotential2014) * VO**2
            Lz = o.Lz(tn) * RO_KPC * 1000 * VO
            b[key] = {"t": (sign * ts).tolist(), "x": from_galpy(R, z, phi).tolist(),
                      "E": E.tolist(), "Lz": Lz.tolist()}

    # ---- Gliese 710 closest approach on both galpy orbits
    gl = next(b for b in bodies if b["name"] == "Gliese 710")
    sun = bodies[0]
    tt = np.linspace(0, 3.0, 300_001) / tu_myr  # 10 yr sampling
    tracks = []
    for b in (sun, gl):
        o = Orbit(to_galpy(np.array(b["gc_x"]), np.array(b["gc_v"])), ro=RO_KPC, vo=VO)
        o.turn_physical_off()
        o.integrate(tt, MWPotential2014, method="dop853_c", rtol=1e-12, atol=1e-14, progressbar=False)
        tracks.append(from_galpy(o.R(tt) * RO_KPC, o.z(tt) * RO_KPC, o.phi(tt)))
    d = np.linalg.norm(tracks[1] - tracks[0], axis=1)
    i = int(np.argmin(d))
    lt, ld = bt.closest_approach(gl["p"], gl["v"])
    gl710 = {"tMyr": float(tt[i] * tu_myr), "dPc": float(d[i]), "linear": {"tMyr": float(lt[0]), "dPc": float(ld[0])}}

    # ---- the Sun's azimuthal period, 2 Gyr
    o = Orbit(to_galpy(np.array(sun["gc_x"]), np.array(sun["gc_v"])), ro=RO_KPC, vo=VO)
    o.turn_physical_off()
    tl = np.linspace(0, 2000, 20001) / tu_myr
    o.integrate(tl, MWPotential2014, method="dop853_c", rtol=1e-12, atol=1e-14, progressbar=False)
    dphi = np.unwrap(o.phi(tl))
    R = o.R(tl) * RO_KPC * 1000
    sun_info = {"periodMyr": float(2 * np.pi * 2000 / abs(dphi[-1] - dphi[0])), "rMin": float(R.min()), "rMax": float(R.max()),
                "zMax": float(np.max(np.abs(o.z(tl))) * RO_KPC * 1000), "vcSun": float(vc_sun)}

    out = {
        "provenance": {"tool": f"galpy {galpy.__version__}", "potential": "MWPotential2014 (Bovy 2015), ro = 8 kpc, vo = 220 km/s",
                       "integrator": "dop853_c", "frame": "R0 = 8275 pc, z_sun = 20.8 pc, (U, V, W)_sun = (11.1, 12.24, 7.25) + vc(R_sun)",
                       "script": "scripts/make_orbit_fixtures.py", "units": "pc, km/s, Myr; accelerations km/s per Myr; E (km/s)^2; Lz pc km/s"},
        "potential": pot, "frame": frame_rows, "bodies": bodies, "gl710": gl710, "sun": sun_info,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT}")
    print(f"vc(R_sun) = {vc_sun:.4f} km/s; Sun period {sun_info['periodMyr']:.2f} Myr, R {sun_info['rMin']:.0f}-{sun_info['rMax']:.0f} pc, |z| <= {sun_info['zMax']:.1f} pc")
    print("frame vs astropy:", [(f["name"][:16], f"{f['dx_pc']:.2e} pc", f"{f['dv_kms']:.2e} km/s") for f in frame_rows])
    print(f"Gl 710 (galpy orbits): t = {gl710['tMyr']:.4f} Myr, d = {gl710['dPc']:.5f} pc; straight line {gl710['linear']}")
    for b in bodies:
        e = np.array(b["future"]["E"] + b["past"]["E"])
        lz = np.array(b["future"]["Lz"] + b["past"]["Lz"])
        print(f"  {b['name'][:40]:40s} galpy |dE/E| {np.max(np.abs(e / e[0] - 1)):.1e}  |dLz/Lz| {np.max(np.abs(lz / lz[0] - 1)):.1e}")


if __name__ == "__main__":
    main()
