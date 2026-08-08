# Simulator Gaps — Work Plan (revised)

Branch: `simulator-gaps`. Each phase is a small vertical slice: model change + assumption entries + unit tests + doc update in `docs/simulation-model.md`. Run `npm run test` and `npm run build` before each commit; push the branch after each phase.

Revision notes (after external review): performance work now leads so later phases that add passes land on the fast path; the bidirectional-demand premise was dropped (ordered reverse pairs already exist and system entries/exits already balance exactly — the real gap is destination development credit); the Phase 1 compatibility test now zeroes both monetary terms; capacity uses directed segment loads, not per-line totals; dwell time added as its own early phase.

## Phase 1 — Routing performance and present-day pass reuse

`fastestTransitPath` runs a full O(V²) Dijkstra per OD pair (~350k runs per simulation across ridership + accessibility × two passes).

- Add `transitTimesFromOrigin(originCoord, graph, ...)` in `routing.ts`: one multi-source Dijkstra per origin (binary-heap priority queue) returning best time + path info to every station; per destination, combine with egress walk. Rework `estimateNetworkRidership` and `calculateAccessibilityScores` to iterate origins outer, destinations inner.
- In `runSimulation.ts`, when `simulationYear === 0` reuse the first-pass ridership/accessibility results instead of recomputing them identically.
- Tests: golden test asserting identical paths/times vs the old per-pair implementation on the demo scenario (keep the old function as a test oracle); present-day results identical before/after the reuse change.
- Stretch (separate commit, only if UI stutter remains): move `runSimulation` into a web worker.

## Phase 2 — Fare and car cost in generalized time

`defaultFare` only appears in revenue, so raising fares is free money.

- Add `valueOfTimeDollarsPerHour` (~$16) and `carCostPerMile` (~$0.35) to `assumptions.ts`. In `ridership.ts` compare `transitMinutes + fare * 60 / VOT` against `carMinutes + carMiles * carCostPerMile * 60 / VOT`.
- Compatibility test: with **both** monetary terms set to zero, results match today exactly (fare-only zeroing does not, since car cost varies with trip distance).
- Calibration targets (explicit, tested as bands not exact values): demo corridor ridership within ±25% of its pre-change value at default fare/costs; ridership strictly decreasing in fare; annual fare revenue has an interior maximum on a $0–$10 sweep.

Status: completed. Default assumptions use a $16/hour value of time and $0.35/mile automobile operating cost. Existing browser scenarios merge in new default assumptions during rehydration.

## Phase 3 — Station dwell time

In-vehicle time is pure distance/speed, so adding intermediate stops is free — players can add stops for access with no service penalty (budgets are advisory).

- Add `dwellMinutesPerStop` per technology (or one global assumption) in `assumptions.ts`; each intermediate station on a path adds dwell to in-vehicle time in `buildTransitGraph` edge costs (charge dwell on arrival at each non-terminal stop).
- Tests: inserting a station between two others increases through-riders' travel time by the dwell; end-to-end time on an N-station line includes (N−2) dwells; zero dwell reproduces today's times.

Status: completed. Default dwell assumptions range from 0.4 minutes for BRT to 0.65 minutes for metro technologies and merge into existing saved scenarios.

## Phase 4 — Capacity and crowding from segment loads

Technologies differ only in speed and cost. `lineRidership` counts every rider who touches a line anywhere, so it cannot serve as a load; crowding needs directed segment loads.

- During assignment in `ridership.ts`, record riders on each **directed station-to-station edge**; a line's peak load is the max directed segment load × a peak-hour share assumption (e.g. 12%).
- Add per-technology capacity to `assumptions.ts`, named unambiguously: `vehicleCapacity` (riders per vehicle) with hourly capacity derived as `vehicleCapacity * 60 / headwayMinutes`, per direction.
- Apply a deterministic crowding multiplier to that line's in-vehicle times when peak load / hourly capacity > ~0.8, then re-run the assignment once (single fixed iteration keeps it deterministic and bounded).
- Tests: equalize technology speeds in fixtures so the test isolates capacity — an overloaded low-capacity line loses riders vs a high-capacity line on the identical alignment; doubling frequency relieves the penalty; uncrowded networks are byte-identical to no-capacity results.

Status: completed. Assignment records directed segment riders, derives hourly capacity from vehicle capacity and headway, and performs at most one crowding-adjusted reassignment.

## Phase 5 — Destination development credit and demand-growth semantics

Two related corrections with the semantics decided up front.

- **Destination credit**: `zoneTransitTrips` only credits origins, so job centers earn no `transitSuccess` in `development.ts`. Track destination-side trips (separate map or credit both ends) and include them in development pressure. Test: a job-rich zone that is the network's top destination gains development pressure relative to today.
- **Demand growth**: the matrix normalizes to a fixed 185,000 trips, so future-year growth redistributes but never adds travel. Decision: **total demand follows all growth** (background downtown-pull growth included, not just transit-induced) — total travel should reflect the region's future population; transit's payoff shows up in mode share and distribution. Normalize 185k against base-year regional totals and scale future-year totals by grown population+jobs (50/50 blend) relative to base. Expose base and future regional trip totals in `SimulationResults` so this is visible and testable.
- Tests: base year totals unchanged at 185k; a +20-year scenario (with or without transit) shows totals above 185k consistent with its zone growth; transit-rich scenarios grow more than no-transit ones.
- Optional (separate commit, only if round-trip commuting is wanted): symmetrize **unordered** zone pairs once — do not blindly mirror the existing ordered matrix, which already contains reverse pairs.

Status: completed for the required scope. Transit activity credits both trip ends, future regional demand follows the 50/50 population-and-jobs growth blend, and results expose base and modeled trip totals. Optional unordered-pair symmetrization remains deferred.

## Phase 6 — Mode choice realism

Equal-time transit currently captures 34% of an OD pair (`maxTransitModeShare 0.68` / 2); ACS vehicle availability sits unused.

- Add a transit-specific constant (extra equivalent minutes) so equal-generalized-cost share lands ~10–15%; recalibrate `modeChoiceBeta` against the demo corridor with explicit target bands.
- Scale each OD pair's max share by origin-zone zero-vehicle household rate (already in zone data).
- Tests: equal-time share within the target band; a zero-vehicle-heavy origin shows higher share than an otherwise-identical zone.

Status: completed. A 17-minute transit-specific constant yields roughly 12% equal-cost share at the base ceiling, while ACS zero-vehicle household rates raise the origin-specific maximum share. The conceptual demo currently produces about 94 weekday riders inside its explicit 75–250 gameplay band.

## Phase 7 — Fidelity cleanups (independent small slices)

1. **Accessibility decay**: replace the binary 30-minute cutoff in `accessibility.ts` with a smooth decay (e.g. logistic around 30 min).
2. **Distance-based transfer walk**: transfer edge cost = walk time from actual station spacing + a smaller fixed penalty, instead of flat 6 minutes for 0–400 ft alike.
3. **Constants into `assumptions.ts`**: car-time normalizers (15,000 jobs / 8,000 density), development pressure weights (0.55/0.25/0.20), jobs factor 0.85, 340 sq ft/job, household size 2.28.
4. **Development**: compound growth across 5-year periods instead of linear `years/5`, and deplete `developmentCapacity` as it's consumed.
5. **Airport as data, not regex**: detect the airport station by proximity to `airportCoordinate` instead of `/airport/i` on names; add a small special-generator demand bonus for airport/UWF zones.

## Phase 8 — Metrics and stretch goals

- **Annualized cost per rider**: add asset-life + discount-rate assumptions and report annualized capital + operating per annual rider.
- Stretch: logit path spreading across near-equal paths (parallel lines currently winner-take-all).
- Stretch: area-weighted zone catchments (needs polygons in the sim data path; cheap alternative is distance-decay weighting of centroid contributions).

## Out of scope for this branch

Park-and-ride / feeder access modeling (deserves its own design), Playwright map tests, bundle-size code-splitting.

## Verification cadence

Per phase: unit tests for the new behavior, `npm run test`, `npm run build`, update `docs/simulation-model.md` equations, one focused commit, push the branch.
