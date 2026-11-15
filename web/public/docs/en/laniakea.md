---
title: Laniakea and the cosmic flows
summary: Galaxies do not just drift apart with the expanding universe. They also fall toward dense regions; the region that falls together around us is Laniakea.
related: [cosmic-web, galaxy, redshift, local-group, desi-survey]
sources:
  - Tully, Courtois, Hoffman & Pomarède 2014, Nature 513, 71, The Laniakea supercluster of galaxies (doi:10.1038/nature13674)
  - Dupuy & Courtois 2023, A&A 678, A176, Dynamic cosmography of the local Universe, Laniakea and five more watershed superclusters (doi:10.1051/0004-6361/202346802)
  - Courtois et al. 2023, A&A 670, L15, Gravity in the local Universe, density and velocity fields using CosmicFlows-4 (doi:10.1051/0004-6361/202245331)
  - Courtois et al. 2025, A&A 701, A187, In search of the Local Universe dynamical homogeneity scale with CF4++ peculiar velocities (doi:10.1051/0004-6361/202553677)
  - Tully 2015, AJ 149, 171, Galaxy groups, a 2MASS catalog (doi:10.1088/0004-6256/149/5/171)
  - NRAO, Newly identified galactic supercluster is home to the Milky Way, https://public.nrao.edu/news/supercluster-gbt/
  - Mei et al. 2007, ApJ 655, 144, The ACS Virgo Cluster Survey XIII (doi:10.1086/509598)
  - Hollinger et al. 2026, A&A accepted, Hidden Vela supercluster revealed (arXiv:2603.09339)
  - astropy documentation, Supergalactic frame (de Vaucouleurs et al. 1976 definition), https://docs.astropy.org/en/stable/api/astropy.coordinates.Supergalactic.html
updated: 2026-11-15
---

## What is it?

The universe expands, so distant galaxies move away from us. But on top of that expansion every
galaxy has its own motion, a **peculiar velocity** of a few hundred kilometres per second, caused by
the pull of the matter around it. Galaxies fall toward dense regions and stream away from empty
voids.

Follow these motions like water running downhill and space splits into **basins of attraction**: all
the galaxies in one basin flow toward the same point, its **attractor**. In 2014 Brent Tully, Hélène
Courtois, Yehuda Hoffman and Daniel Pomarède drew the basin that contains the Milky Way and named it
**Laniakea**, "immense heaven" in Hawaiian. It is about 500 million light-years across and holds about
100,000 large galaxies with the mass of a hundred million billion Suns.

The point Laniakea's galaxies flow toward is the **Great Attractor**. In the CF4 maps it lies about
100 Mpc away (Hubble-flow velocity 7,400 km/s), only 3° from the plane of the Milky Way, so the dust
of our own Galaxy hides much of it.

## How do we know?

The redshift of a galaxy mixes two things: the expansion and the galaxy's own motion. To separate
them you need a distance that does not come from the redshift. **Cosmicflows-4** (CF4) collects such
distances for 56,000 galaxies, from Cepheids, the tip of the red giant branch, supernovae, the
Tully-Fisher relation and others. Subtracting the expansion gives the peculiar velocities.

From those velocities a statistical method (Hamiltonian Monte Carlo) rebuilds the whole 3D
velocity field and the matter density that causes it, including the **dark matter** we cannot see.
Courtois and colleagues published these maps in 2023, and an update with 9,642 more galaxy
distances (CF4++) in 2025. In 2023 Alexandra Dupuy and Hélène Courtois traced the flow lines through the CF4
field and found Laniakea again, plus five more basins: **Apus**, **Hercules**, **Lepus**,
**Perseus-Pisces** and **Shapley**.

Astronomers usually draw these maps in **supergalactic coordinates**. Gérard de Vaucouleurs noticed
that nearby bright galaxies lie close to one plane, the **supergalactic plane**. Its axes are SGX, SGY
and SGZ; its north pole points to Galactic longitude 47.37° and latitude +6.32°. Looking down on this
plane shows the local structures with the least overlap.

## Surprising but true

- The Milky Way does not sit at the centre of Laniakea but on its outskirts. The Virgo Cluster, about
  16.5 Mpc (54 million light-years) away and long thought the centre of our "Local Supercluster", is
  only one small part of Laniakea.
- Whether a basin counts as separate depends on the data: in the version of CF4 that averages
  galaxies into groups, Laniakea is swallowed by the Shapley basin.
- Maps of the flows still have a blind spot: the Milky Way's own dust hides about a fifth of the sky.
  In 2026 Amber Hollinger and colleagues added new radio redshifts behind it and found that the
  hidden **Vela supercluster**, about 189 h⁻¹ Mpc away, may be as massive as Shapley.
- The velocity maps use distances "in h⁻¹ Mpc", a unit that leaves the Hubble constant open. The
  CF4 distances fit a Hubble constant of 75 km/s per Mpc; the Planck satellite's cosmology, used for
  the redshift layers of this atlas, gives 67.66.

## Where to find it in this atlas

- [Supergalactic view](#focus=supergalactic) looks down on the supergalactic plane, with the
  [supergalactic grid](#layer=sg-grid): red SGX and green SGY axes and distance rings in Mpc.
- [Laniakea](#focus=laniakea) turns on the [cosmic flows](#layer=cf4-flow): streamlines traced
  through the CF4++ velocity field, coloured by the basin of Dupuy and Courtois they start in
  (Laniakea orange, Shapley pink, Perseus-Pisces blue, Lepus green, Apus violet, Hercules cyan). The
  lines brighten toward their end, so you can see where they flow.
- The [density layer](#layer=cf4-density) shows where matter is clearly denser than average. It is
  smooth because the reconstruction is smoothed over about 8 h⁻¹ Mpc: single clusters such as Virgo
  are too small to show.
- Fly to the [Great Attractor](#focus=great-attractor), [Shapley](#focus=shapley),
  [Perseus-Pisces](#focus=perseus-pisces), the [Coma Cluster](#focus=coma-cluster) or the
  [Virgo Cluster](#focus=virgo-cluster).
- The [galaxy groups](#layer=groups-2mrs) layer marks 6,201 groups of the 2MASS Redshift Survey with
  two or more members (Tully 2015). Click one to see its brightest members, its mass and how fast its
  galaxies move about.

How the scales are matched: the velocity maps are in h⁻¹ Mpc and are drawn here with the Planck18
value h = 0.6766, so they line up with the galaxies placed by redshift. At CF4's own scale
(H0 = 75) everything would be about 10 % closer; the info cards show both distances. The streamlines
were traced for this atlas through the CF4++ field of 2025, while the basin colours come from the CF4
field of 2023, so near basin edges a line can end in a neighbouring basin.
