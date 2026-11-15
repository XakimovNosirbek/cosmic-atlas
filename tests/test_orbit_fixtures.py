"""The galpy reference orbits (web/test/fixtures/orbits/galpy_mw2014.json, written by
scripts/make_orbit_fixtures.py) are what web/test/orbits.test.ts holds the viewer's integrator to.
Check that the file says what it should: conserved energy and Lz, the Sun's orbit, the Gl 710
encounter, the frame against astropy, and (when galpy is installed) a fresh galpy evaluation."""

import json
from pathlib import Path

import numpy as np
import pytest

FIX = Path(__file__).resolve().parents[1] / "web" / "test" / "fixtures" / "orbits" / "galpy_mw2014.json"
F = json.loads(FIX.read_text())


def test_six_bodies_both_directions_100_myr():
    names = [b["name"] for b in F["bodies"]]
    assert names[0] == "Sun" and "Gliese 710" in names and "Barnard's Star" in names and len(names) == 6
    for b in F["bodies"]:
        assert b["future"]["t"][-1] == pytest.approx(100.0) and b["past"]["t"][-1] == pytest.approx(-100.0)
        assert len(b["future"]["x"]) == len(b["future"]["t"]) == 21


def test_galpy_conserves_energy_and_lz():
    for b in F["bodies"]:
        for key in ("future", "past"):
            e = np.array(b[key]["E"])
            lz = np.array(b[key]["Lz"])
            assert np.max(np.abs(e / e[0] - 1)) < 1e-9
            assert np.max(np.abs(lz / lz[0] - 1)) < 1e-9


def test_frame_matches_astropy():
    for f in F["frame"]:
        assert f["dx_pc"] < 1e-4 and f["dv_kms"] < 1e-3


def test_sun_orbit():
    s = F["sun"]
    assert s["vcSun"] == pytest.approx(219.236, abs=1e-3)  # MWPotential2014 at R_sun = 8.275 kpc
    # azimuthal period of the integrated orbit: ~250 Myr with this potential (guiding radius
    # outside R0 because vc is low); the circular period at R0 is 2 pi R0 / vc
    assert 240 < s["periodMyr"] < 260
    circ = 2 * np.pi * np.sqrt(8275.0**2 - 20.8**2) / s["vcSun"] / 1.022712165045695
    assert 220 < circ < 240
    assert 8100 < s["rMin"] < 8275 < s["rMax"] < 9600 and 90 < s["zMax"] < 130


def test_gliese_710():
    g = F["gl710"]
    assert g["tMyr"] == pytest.approx(1.3, abs=0.05)
    assert g["dPc"] == pytest.approx(0.05, abs=0.01)
    assert g["linear"]["dPc"] == pytest.approx(0.0512, abs=1e-3)


def test_galpy_still_agrees():
    galpy = pytest.importorskip("galpy")
    from galpy.potential import MWPotential2014, vcirc
    assert vcirc(MWPotential2014, np.sqrt(8.275**2 - 0.0208**2) / 8.0) * 220.0 == pytest.approx(F["sun"]["vcSun"], rel=1e-12)
    assert galpy.__version__
