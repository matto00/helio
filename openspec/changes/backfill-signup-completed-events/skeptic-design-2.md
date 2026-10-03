## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
- Re-read ticket, proposal, design, tasks, spec delta; checked each round-1 change request.
- CR1 (non-NULL rolled_through): verified against code. ProductEventRollupService.tickAt starts at min(rt+1, today-1) for Some(rt). Lowering rt to (earliest backfilled day - 1) makes tickAt roll from the earliest backfilled day. rollupDayAction's `covered` guard is `day <= rt`, so lowered days are not covered and are recomputed; setRolledThrough only moves forward and the rollup range re-advances the mark to today-2. The reset is mechanically sound. The NULL case is handled (earliestEventDay now returns the earliest signup). The spec delta now has both scenarios and tasks 3.1-3.3 test both NULL and NON-NULL starts.
- Corruption bound is stated honestly and holds: telemetry is days old vs retentionDays 90, nothing purged; task 3.4 tests the guard.
- CR2: research task replaced by implementation + tests (3.1-3.4). CR3: 2.4 asserts on a fresh statement under the non-superuser role; 3.5 covers empty users. CR4: privilege assumption and red-first setup (same as FlywayNonSuperuserMigrationSpec) are in Decision 1, with bracket fallback.
- No placeholders/contradictions found; ACs all map to tasks.

### Verdict: CONFIRM

### Non-blocking notes
- AdminUsageService.MaxDays = 90: the endpoint can only display a 90-day window ending at rolled_through, so the AC "back to earliest real user" is only visibly met for users within 90 days. Rollup rows will exist for the full history; the executor should state this in the PR rather than treat it as a V114 defect (do not change MaxDays without owner direction).
- Between V114 and the next tick, rolled_through is lowered so /admin/usage's window ends earlier (transient, up to one tick interval); worth one line in the PR.
- Historical DAU is signup-only; WAU is NULL beyond retention (existing wauComputable). Already documented.
