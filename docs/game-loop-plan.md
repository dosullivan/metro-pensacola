# Game Loop Plan — Making Metro Pensacola Feel Like a Game

The simulator now has honest incentives (fare elasticity, dwell cost, capacity, crowding), a fast cached model, and a Web Worker. What it does not have is a loop: no time passing, no constraint that binds, no goal, no failure, no progression. This plan adds that loop in playable increments.

Branch strategy: merge `simulator-gaps` to `main` first, then build these phases on a `game-loop` branch. Each phase is a vertical slice with unit tests, `npm run test`, `npm run build`, a browser smoke test for UI phases, and one focused commit, per AGENTS.md.

## Design stances (decided up front)

- **Honest numbers.** The calibrated model produces small, realistic ridership (the demo BRT network carries ~260 weekday riders). Goals and milestones are authored against what the model actually produces — early milestones in the hundreds, late-game rail-plus-growth in the low thousands — rather than inflating demand. A single optional `gameplayDemandMultiplier` assumption (default 1) is the one escape hatch, exposed but not used by default.
- **Sandbox stays.** The current free-form planner remains as Sandbox mode. The game loop is a per-scenario mode flag (`sandbox` | `career`). Existing scenarios, tests, and behavior are untouched in Sandbox; every mechanic below applies only in Career mode.
- **Deterministic everything.** Events, milestones, and time advancement derive from model state, never randomness. Same inputs, same playthrough.
- **Recompute, don't accumulate.** The advancing clock sets `scenario.simulationYear` and recomputes from base-year zones deterministically (the model already supports this), rather than persisting mutated zone state. Saves stay small and consistent.

## Phase 1 — Live simulation

Auto-run the simulation as the player edits, replacing the run-button loop with immediate feedback. The worker and caches make this affordable: warm runs are 0.1–0.4 s and a station drag only invalidates that station's cached geometry.

- Store subscription watches the simulation-input fingerprint (already implemented for the race guard); on change, schedule a debounced (~300 ms) worker run.
- Change the mid-run-edit policy from discard-with-notice to **latest-wins rescheduling**: when a run completes against a stale fingerprint, immediately queue a run against the current one. Never show the "run again" notice in auto mode.
- Keep the manual Run button working as a fallback and as the only mode when auto-sim is toggled off; subtle "simulating" indicator instead of a disabled button.
- Tests: edit during a run schedules exactly one follow-up run with the latest fingerprint; unchanged fingerprint schedules nothing (no infinite rerun loop); debounce coalesces rapid edits.

Status: completed. Scenarios now persist `sandbox | career` mode and a per-scenario live-results toggle. Sandbox retains the manual workflow; Career enables a 300 ms debounced store subscription. In-flight edits use latest-wins scheduling, rapid edits coalesce, unchanged fingerprints do not rerun, and the manual Run control remains available without locking the surrounding UI.

## Phase 2 — Hard budgets and funding progression

The single change that creates an early game: you cannot afford rail on day one.

- Career scenarios start with limited capital (tune from ~$500M; enough for a modest BRT starter line) and an annual operating subsidy cap. Remaining funds live on the scenario and persist.
- Construction spends capital when lines/stations are added; edits that would exceed remaining capital are blocked with a clear notice. Demolition refunds a configurable fraction (~50%).
- **Funding milestones**, data-driven in `src/data/gameplay.ts`: e.g., 300 weekday riders → state grant +$250M; 25,000 residents within walking distance → federal match +$500M; first crowded line → "capacity relief" rail funding. Each unlocks once, fires a news message, and persists. The technology cost ladder in `assumptions.ts` becomes the progression system for free, and crowding (Phase 4 of the simulator work) gives the BRT→rail upgrade an organic trigger.
- UI: funds panel (remaining capital, ops subsidy vs. cost) and a milestone list with progress bars.
- Tests: over-budget edit blocked; milestone unlocks exactly once and adds funds; refund math; persistence round-trip through the store merge.

Status: completed. Career scenarios persist a $500M starting capital account and $25M annual operating-subsidy cap. All capital-changing build actions use one transaction path: additions and upgrades spend their incremental construction cost, unaffordable edits are rejected with an explicit notice, and removals refund 50% of the retired value. Existing networks are grandfathered when switching modes—their construction value is deducted from starting funds, floored at zero—so old saves remain playable without receiving surplus cash. Three milestones live in `src/data/gameplay.ts`, unlock once from simulation outputs, add grants, and prepend funding news to the result messages. The build panel shows capital funds, subsidy against its cap, and milestone progress. Store and pure-logic tests cover blocking, refund math, one-time grants, and persistence.

## Phase 3 — Advancing time

Turn the +5/+10/+20 dropdown into a clock the player drives.

- "Advance Year" control (later: multi-year advance). The clock sets `simulationYear`; development growth, compounding and capacity-depleting, now happens *to* the player.
- **Construction takes time**: lines open after `mileage / constructionMilesPerYear` (per technology; subway slowest). Under-construction lines render dashed, carry no riders, and count no operating cost until opening year.
- Finances accrue per advance: operating cost minus fare revenue draws down the subsidy budget; a deficit forces a choice event (cut frequency, raise fare, or take a grant with strings) rather than a silent game-over.
- Tests: no ridership before opening year; opening year math per technology; annual accrual; deterministic replay of a multi-year sequence.

Status: completed. Career replaces the free year picker with a one-year Advance Year clock and persists cumulative operating subsidy. New lines and capital-increasing upgrades receive a construction start and opening year from their mileage and technology rate (BRT 10 mi/year, light rail 5, elevated metro 3, subway 1.5, with a one-year minimum). Existing networks are grandfathered as open. Closed lines render dashed with construction status, have no active catchments, carry no riders, and incur no operating cost; all four behaviors use the same `isLineOpen` rule. Advancing accrues the current result's subsidy exactly once and clears it before simulating the next year. An over-cap year stops the clock on a persisted deterministic choice: reduce every open line one frequency step, raise fares by $0.50 and reforecast, or accept an emergency grant that advances the year but removes twice the deficit from capital funds. Tests cover the opening boundary, technology duration ordering, accrual, deficit choices, and replay determinism.

## Phase 4 — Goals and events with consequences

- **Objectives**, data-driven per scenario: target metrics by year ("1,500 weekday riders by 2040", "connect the airport" via the existing coordinate-based detection, "keep subsidy under $X/yr"). Evaluated on each advance; end-state summary screen with win/lose and stats.
- **Events with teeth**: upgrade the message system so triggers have small mechanical effects — the airport-success message grants a demand bonus at the airport generator; "council questions line X" starts a 2-year countdown to an ops-budget cut unless ridership improves; a station boom raises nearby development capacity. All deterministic, all data-driven in the same gameplay config.
- Tests: objective evaluation edges (met exactly at deadline, missed), each event effect applies exactly once, effects serialize.

Status: completed. Career objectives are plain definitions in `src/data/gameplay.ts`: open an airport connection by Year 10, then reach 1,500 weekday riders and hold annual subsidy to $25M or less in Year 20. Results remain pending before their deadline, lock as met/missed at the deadline, and produce a persisted Year 20 win/loss summary with final ridership, subsidy, and capital. Three data-driven events now share thresholds with their simulation news messages and apply once: 40 daily airport station movements add a permanent airport-only 10% demand bonus; a line above $450,000 construction cost per daily rider starts a two-year review and loses $5M from the annual subsidy cap unless ridership improves 25%; and 100 movements at the busiest station add up to 0.15 weighted development capacity across its one-mile catchment. Event IDs, active review, objective results, capacity bonuses, and final outcome all persist. Tests cover exact and off-by-one objective thresholds, each mechanical effect, repeated evaluation, council expiry, model impact, and persistence.

## Phase 5 — Map life

Pure theater, disproportionate payoff. No model impact.

- Animated vehicles moving along line geometry, spaced by headway, speed from technology, paused when the tab is hidden.
- Station ridership pulses scaled by entries+exits; dashed under-construction styling (shared with Phase 3).
- Tests: unit-test the position-interpolation function (distance along polyline at time t); visual check in browser.

## Sequencing and scope notes

- Order is deliberate: each phase ships something playable alone. Live sim (1) makes everything after it feel responsive; budgets (2) create the early game before time (3) creates the long game; goals (4) give time a point; theater (5) is last because it depends on nothing.
- Numbers above ($500M, 300 riders, miles/year) are starting guesses — tune each against the live model during its phase, and keep every constant in `assumptions.ts` or `src/data/gameplay.ts`, never inline.
- Out of scope: park-and-ride/feeder access (own design doc), multiplayer, audio, scenario sharing, Playwright coverage (worth adding once UI mechanics exist, but not blocking).
