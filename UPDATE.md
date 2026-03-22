   What's bundled in the Docker image

  ┌──────────────┬─────────┬────────────────────────────────────────────────────┬───────────────────────────────────────────────────────┐
  │  Dependency  │ Version │                    What it does                    │                    Where it lives                     │
  ├──────────────┼─────────┼────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
  │ CesiumJS     │ 1.124   │ 3D globe renderer (WebGL)                          │ Downloaded during docker build from GitHub releases   │
  ├──────────────┼─────────┼────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
  │ satellite.js │ 5.0.0   │ Computes satellite positions from TLE orbital data │ Downloaded during docker build from unpkg             │
  ├──────────────┼─────────┼────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
  │ TLE data     │ Live    │ Actual orbital parameters for GPS satellites       │ Fetched at runtime from celestrak.org every page load │
  └──────────────┴─────────┴────────────────────────────────────────────────────┴───────────────────────────────────────────────────────┘

  What needs updating and when

  CesiumJS (yearly-ish) — Cesium releases monthly but you only need to update if:
  - Terrain/imagery tiles stop working (Cesium Ion deprecates old API versions)
  - You want new features
  - Security patches

  To check: compare your version against https://github.com/CesiumGS/cesium/releases. To update: change 1.124 to the new version in the Dockerfile
  and rebuild.

  satellite.js (rarely) — The math for orbital mechanics doesn't change. Only update if there's a bug fix. Current v5.0.0 is stable. Check
  https://github.com/shashwatak/satellite-js/releases.

  TLE data (automatic, no action needed) — This is the only thing that changes frequently. TLEs go stale after a few days as orbits drift. The page
  fetches fresh TLEs from CelesTrak every time it loads, so this is always current. No image rebuild needed.

  Cesium Ion token (check yearly) — Free tokens can expire. If the globe stops loading terrain, regenerate at cesium.com/ion.

  Python deps (Flask, Paramiko, Cryptography) — Only update for security patches. Check with pip list --outdated inside the container.

  How to check if anything needs updating

  # Inside the running container:
  docker exec chronolens python3 -c "import flask; print('Flask', flask.__version__)"
  docker exec chronolens python3 -c "import paramiko; print('Paramiko', paramiko.__version__)"

  # Check Cesium version (in Dockerfile):
  grep "Cesium-" Dockerfile

  # Check if CelesTrak is reachable (TLE source):
  curl -s -o /dev/null -w '%{http_code}' https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle

  The short version: TLEs update themselves. Everything else is pinned and only needs attention once or twice a year.
