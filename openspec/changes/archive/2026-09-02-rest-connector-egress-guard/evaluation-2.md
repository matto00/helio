## Evaluation Report — Cycle 2 (evaluation-2.md)

Scope reviewed: `3d5e0739..489c2f5c` (bookkeeping only), on top of cycle 1's findings for
`7ad8a2dc..3d5e0739`.

Diff confinement verified myself, not taken on report: `git diff --name-only 6b134228..489c2f5c`
touches zero files under `backend/` (evaluation-1.md, files-modified.md, tasks.md only). Working
tree clean. Cycle 1's Phase 2 findings — gates 3605/3605, both mutation probes, the seven-fixture
`admitLocalhost` audit, the `fetchOverride = None` accounting — therefore stand unchanged and were
not re-run.

### Phase 1: Spec Review — PASS

**CR1 (task 5.2 / ticket AC6) — satisfied, and independently reproduced.** The `## Evidence`
section records all three queries with exact SQL, the observed counts, the Decision-7 disposition,
and an explicit no-production-database statement. I re-ran all three queries myself against the
dev database named in `backend/.env` (`localhost:5432/helio`) and got identical results:

| Query | Recorded | My re-run |
| --- | --- | --- |
| `count(*) from connectors` | 106 | 106 |
| connectors with a disallowed-address literal in `base_url` | 0 | 0 |
| legacy bare-url `rest_api` data_sources | 0 | 0 |

The disposition is stated correctly and honestly: zero rows are newly broken, and the write-up says
so as a recorded zero rather than eliding the question. It also states what *would* happen to such
a row (fetch-time refusal, no scan/rewrite/delete) per Decision 7.

**CR2 (task 5.3 / ticket AC7) — satisfied.** The section names the endpoint
(`https://api.sleeper.app/v1/state/nfl`), how it was exercised (a `new RestApiConnectorDriver()`
with real production defaults and `fetchOverride = None`, through the real `issueAndParse` issuer,
not a stub), and the observed outcome with a JSON excerpt.

I corroborated the excerpt independently: `curl -s https://api.sleeper.app/v1/state/nfl` returns
the same ten fields with the same values recorded
(`week:1, leg:1, season:"2026", season_type:"regular", league_season:"2026",
previous_season:"2025", season_start_date:"2026-09-09", display_week:1,
league_create_season:"2026", season_has_scores:true`). That does not re-prove the guarded code
path, but it does establish the recorded observation is a real observation of the real endpoint
and not a plausible-looking fabrication — which was the residual risk of an uncommitted probe.

### Ruling: is a recorded-but-non-reproducible live-endpoint observation sufficient for AC7?

**Yes. No committed live-network spec is required, and I would decline one if offered.** Reasoning:

1. AC7 asks that legitimate external URLs "continue to work — verified against the live Sleeper
   endpoint". That is a *delivery-time proof*, not a standing *guard*. The repo's own distinction
   applies: a proof must be observed once and recorded; a guard must be failable by mutation and
   live in CI. Conflating them is how live-network dependencies get into test suites.
2. The guard-shaped half of AC7 — "an allowed destination still succeeds through the real guarded
   issuer, carrying method/headers/body" — *is* already committed, reproducible and
   mutation-verified: task 4.7 in `RestConnectorEgressGuardSpec`, which cycle 1's mutant B showed
   is one of only two tests that survive guard removal precisely because it is the positive path.
   The only thing the live Sleeper check adds over 4.7 is real DNS + real TLS + a real third-party
   host. Committing that as a test would buy that increment at the cost of a CI job that fails when
   Sleeper has an outage, changes its response shape, or rate-limits the runner — a flake with no
   corresponding defect in this repo.
3. An `@Ignore`/tagged-by-default spec is the worst of both: it does not run, so it proves nothing
   on its own, and it accrues rot (an ignored spec that no longer compiles against a refactored
   driver is discovered years later). The recorded observation plus a reproducible *recipe* is
   strictly more useful, and the recipe is present — the write-up states the exact constructor,
   method and URL, so any reviewer can reconstruct the probe in a minute.
4. The reproducibility gap that mattered was verifiability of the *claim*, and that is now closed
   by external corroboration (the curl above) rather than by adding CI surface.

So: accepted as-is. This is a deliberate ruling, not an oversight — recorded for whoever reads this
later and wonders why AC7 has no test.

### Phase 2: Code Review — PASS

No code changed. Cycle-1 verdict carried forward: `sbt test` 3605/3605 (my own run), guard
probe-confirmed load-bearing (33/35 fail on guard removal; 4.5 fails on pin removal), all seven
modified fixtures hostname-keyed with no address-class widening.

### Phase 3: UI Review — N/A

No `frontend/**`, `schemas/**` or `openspec/specs/**` change in this cycle or the previous one.

### Overall: PASS

Cycle 1's two change requests are both discharged, one of them independently reproduced end-to-end
and the other independently corroborated. Ticket AC1–AC7 are all met.

### Non-blocking Suggestions

Cycle 1's three suggestions stand and remain non-blocking (duplicated `admitLocalhost` helper
across seven test files; the create-path validate-before-`parseKind` ordering change; the new real
DNS dependency on `example.com` in two specs). None should hold up merge of an Urgent security fix.
