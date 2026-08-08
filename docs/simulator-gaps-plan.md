# Simulator Gaps — Work Plan

Branch: `simulator-gaps`. Each phase is a small vertical slice: model change + assumption entries + unit tests + doc update in `docs/simulation-model.md`. Run `npm run test` and `npm run build` before each commit. Phases are ordered so incentive-breaking gaps go first and performance work lands before the phases that add compute.

## Phase 1 — Fare affects ridership

Today `defaultFare` only appears in revenue (`runSimulation.ts`), so raising fares is free money. Fold fare into transit generalized time.

- Add `valueOfTimeDollarsPerHour` to `assumptions.ts` (suggest ~$16, i.e. $1 ≈ 3.75 min).
- In `ridership.ts`, compare `path.totalMinutes + fare * 60 / valueOfTime` against car time. Give the car side a symmetric monetary term: `carCostPerMile` (gas/wear, ~$0.35/mi) converted the same way, replacing nothing else.
- Tests: higher fare → lower ridership, monotonic; revenue as a function of fare has an interior peak; fare = 0 matches today's behavior within tolerance after recalibration.

## Phase 2 — Capacity and crowding

Technologies differ only in speed and cost; BRT at 30-minute headways can carry unlimited riders. Add capacity so the mode ladder means something.

- Add `peakCapacityPerHour` per technology in `assumptions.ts` (per direction at a reference headway; effective capacity scales with `baseHeadwayMinutes / headwayMinutes`).
- Estimate each line's peak load from assigned ridership (daily riders × peak-hour share assumption, e.g. 12%, on the max-load segment — approximating with total line ridership is acceptable for the first cut).
- Apply a deterministic crowding multiplier to in-vehicle time when load/capacity > ~0.8, then re-run the ridership pass once (fixed single iteration keeps it deterministic and bounded).
- Tests: overloaded BRT corridor loses riders relative to light rail on identical alignment; doubling frequency relieves the penalty; uncrowded results unchanged.

## Phase 3 — Routing performance restructure

Do this before phases that add passes. `fastestTransitPath` runs a full Dijkstra per OD pair (~87k pairs × 2 ridership passes, plus ~87k × 2 in accessibility ≈ 350k runs), and the inner loop is O(V²).

- Add `transitTimesFromOrigin(originCoord, graph, ...)` in `routing.ts`: one multi-source Dijkstra per origin returning best time + path info to every station; per destination, combine with egress walk. Use a binary-heap priority queue.
- Rework `estimateNetworkRidership` and `calculateAccessibilityScores` to iterate origins outer, destinations inner (~300× fewer Dijkstra runs).
- Tests: golden test asserting identical paths/times vs the old per-pair implementation on the demo scenario; keep the old function as a test oracle.
- Stretch (separate commit, only if UI stutter is still noticeable): move `runSimulation` into a web worker.

## Phase 4 — Let total demand grow

`createDemandMatrix` normalizes to a fixed 185,000 trips, so +20-year development redistributes trips but never adds any — muting the long-range payoff.

- Normalize to 185k against the *base-year* population/jobs totals; in future years scale `totalDailyRegionalTrips` by the growth in regional population+jobs (blended, e.g. 50/50) relative to base.
- Tests: base year unchanged; +20-year scenario with growth shows total trips > 185k; no-transit scenario stays at base.

## Phase 5 — Bidirectional demand and destination credit

Demand flows only population → jobs: residential stations only board, downtown never gets `transitSuccess` credit in development.

- Mirror each OD pair with a return trip (half the trip weight each way, keeping totals constant).
- Credit `zoneTransitTrips` at both ends (or add a destination map) so `development.ts` pressure sees job centers.
- Tests: entries ≈ exits system-wide; downtown-style job zone gains development pressure when it's the top destination.

## Phase 6 — Mode choice realism

Equal-time transit currently captures 34% of an OD pair (`maxTransitModeShare 0.68` / 2) — wildly high for the region, and ACS vehicle availability data sits unused.

- Add a transit-specific constant (extra minutes penalty) to the logistic so equal-time share lands nearer 10–15%; recalibrate `modeChoiceBeta` so the demo corridor produces defensible numbers.
- Scale each OD pair's max share by origin-zone zero-vehicle household rate (already in the zone data): car-free households get a higher ceiling.
- Tests: equal-time share within target band; zero-vehicle-heavy origin zone shows higher share than an otherwise-identical zone.

## Phase 7 — Fidelity cleanups (independent small slices)

1. **Accessibility decay**: replace the binary 30-minute cutoff in `accessibility.ts` with a smooth decay (e.g. logistic around 30 min) to kill cliff effects.
2. **Distance-based transfer walk**: transfer edge cost = walk time from actual station spacing + a smaller fixed penalty, instead of flat 6 minutes for 0–400 ft alike.
3. **Constants into `assumptions.ts`**: car-time normalizers (15,000 jobs / 8,000 density), development pressure weights (0.55/0.25/0.20), jobs factor 0.85, 340 sq ft/job, household size 2.28.
4. **Development**: compound growth across 5-year periods instead of linear `years/5`, and deplete `developmentCapacity` as it's consumed.
5. **Airport as data, not regex**: detect the airport station by proximity to `airportCoordinate` (already in assumptions) instead of `/airport/i` on names; add a small special-generator demand bonus for airport/UWF zones.

## Phase 8 — Metrics and stretch goals

- **Annualized cost per rider**: add asset-life + discount-rate assumptions and report annualized capital + operating per annual rider, so build-cheap/run-expensive vs the opposite becomes comparable.
- Stretch: logit path spreading across near-equal paths (parallel lines currently winner-take-all).
- Stretch: area-weighted zone catchments (needs block-group polygons in the sim data path; cheap alternative is distance-decay weighting of centroid contributions).

## Out of scope for this branch

Park-and-ride / feeder access modeling (big feature, deserves its own design), Playwright map tests, bundle-size code-splitting.

## Verification cadence

Per phase: unit tests for the new behavior, `npm run test`, `npm run build`, update `docs/simulation-model.md` equations, one focused commit. Push the branch to `gitea` after each phase so handoff can continue elsewhere.
