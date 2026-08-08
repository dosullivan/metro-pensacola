# Metro Pensacola Agent Handoff

## Project

Metro Pensacola is a browser-based urban transit planning game for the Pensacola, Florida region. It is a React + TypeScript + Vite app using MapLibre GL JS, Zustand, and Turf.js. The MVP runs locally with no backend:

```bash
npm install
npm run dev
```

Keep the finished simulation frontend-only unless the user explicitly changes the architecture.

## Core Commands

```bash
npm run dev
npm run test
npm run build
```

After making code or data changes, run the relevant tests and `npm run build`. For UI/map changes, also smoke-test the local dev server in a browser or with a `curl -I` check.

When work is committed, push it:

```bash
git push gitea main
```

## Current Data State

The app uses real generated geographic/demographic data plus gameplay-derived modeling fields.

- Census/ACS/LODES zones: full Escambia County and Santa Rosa County block groups.
- OSM road-snapping corridors: full Escambia County and Santa Rosa County OSM relation areas.
- The Census zone data is bundled into `src/data/pensacola/zones.ts`.
- The OSM corridor network is a static GeoJSON asset loaded lazily when Road Snap is enabled, then converted into a routable graph in the browser.

Generated data files are intentionally large:

- `src/data/pensacola/zones.ts`
- `public/data/pensacola/block-groups.geojson`
- `public/data/pensacola/osm-corridors.geojson`
- `src/data/pensacola/osmCorridorsMetadata.ts`

Do not hand-edit generated data files. Update the scripts and regenerate them.

## Data Refresh

Refresh ACS/LODES simulation zones:

```bash
python3 scripts/prepare-census-data.py \
  --out src/data/pensacola/zones.ts \
  --geojson-out public/data/pensacola/block-groups.geojson
```

Refresh OSM road-snapping corridors:

```bash
python3 scripts/prepare-osm-data.py \
  --out public/data/pensacola/osm-corridors.geojson \
  --metadata-out src/data/pensacola/osmCorridorsMetadata.ts
```

Both scripts download official/source data and require network access. Use `--bbox west,south,east,north` only when intentionally producing a smaller clipped study area. The default should remain full Escambia and Santa Rosa coverage.

## Architecture Notes

- Simulation logic belongs in `src/simulation/` and should stay mostly pure and unit-testable.
- UI state belongs in `src/store/scenarioStore.ts`.
- Map rendering and map interactions belong in `src/components/map/TransitMap.tsx`.
- Gameplay assumptions belong in `src/data/assumptions.ts`.
- Scenario/demo data belongs under `src/data/pensacola/`.
- Documentation lives in `README.md` and `docs/`.

Prefer small, working vertical slices over large unfinished UI shells. Every number shown to the user should come from an explainable equation or documented assumption.

## Modeling Constraints

This is not a microscopic traffic simulator. Keep the model deterministic and aggregate:

- Zone-to-zone gravity demand, not individual agents.
- Dijkstra-style transit routing over station/line graphs.
- Configurable costs, speeds, fares, penalties, and mode choice constants.
- Simple development response around accessibility and capacity.

Increasing capital cost should not change ridership. Faster service, shorter headways, better station placement, and useful transfers should generally increase ridership.

The drawn route polyline controls map appearance and construction mileage. Transit travel time currently uses ordered station-to-station distance with a circuity factor, so route bends alone should not change ridership.

## Current Limitations

- The full ACS zone dataset makes the production JS bundle large; future work should lazy-load or code-split zone data.
- The full-county OSM road file is roughly 34 MB. It is lazy-loaded, but graph construction and nearest-segment checks happen in the browser without a spatial index.
- Demand and accessibility score ordered zone pairs, but heap-based transit routing is cached per origin. Future-year runs use initial and final model passes; Present Day reuses the first pass.
- There are no Playwright visual/runtime tests for map interactions yet.
- Route editing is functional but still basic.
- ACS/LODES data is real, but land value, development capacity, and commercial square feet remain gameplay-derived.

## Git Hygiene

The repo may contain user changes. Do not revert changes you did not make. Keep commits focused, run verification before committing when practical, and push to `gitea main` after committing so the Mac mini handoff can continue from the latest work.
