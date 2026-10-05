## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 5ae66fc110fc7b6351ed512694c7bf0319f86f85. The planning artifacts are untracked in the change dir.
Cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/output-history-store-summary/HEL-1271`.

### Round-2 change requests: were they fixed in substance?

1. **CR1 (RLS proof mutations, insert pin, FORCE): fixed.**
   - tasks.md 1.3 now names one red mutation per assertion:
     - SELECT `USING (true)` turns non-grantee-sees-0 red.
     - INSERT `WITH CHECK (true)` turns insert-rejection red.
     - A direct-ownership policy turns grantee-visible red.
   - The insert assertion is pinned to the `row-level security policy` message, and "dropping FORCE" is struck.
   - Ground truth for why each mutation can actually go red:
     - **The INSERT rejection comes from RLS, not from a missing GRANT.** `RlsSharingAwareTablesSpec.scala:~90` runs `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test` after migrating. The new table is therefore granted, so a no-context INSERT gets past the privilege check and reaches the policy.
     - **A missing context returns FALSE rather than raising an error.** `helio_can_access_pipeline` (V39:28-45) reads `current_setting('app.current_user_id', true)` (missing_ok) and returns FALSE on NULL or empty. That produces the "new row violates row-level security policy" message.
     - **No REVOKE of EXECUTE exists in any migration** (grep returned zero hits). PUBLIC can execute the function, so `helio_app_test` can evaluate it.
     - **The FORCE proof is real.** `RlsPolicyGuardSpec.scala:205,251` already asserts `relforcerowsecurity = true` for every key in `rlsTables`. Registering the table in task 1.2 proves FORCE automatically.
2. **CR2 (subnormal group keys): fixed.** D-2 drops the "always shortest" claim and adds a minimization step for k = 2. The `5e-324` and `1e-323` fixture cases are listed in the D-2 fixture list. Both cases are real JDK-vs-JS divergences (confirmed in round 2; see the probe below).

### Round-1 fixes still hold
- **CR1 (coerce via `max`):** design.md D-2 still drives coerce cases through `computeAggregate([{f: value}], "f", "max")`, and tasks 2.4(a) still names the blank-as-0 mutation. Against the live `aggregate.ts`, `max` returns null when nothing coerces.
- **CR2 (ES `Number::toString` case analysis):** present, with the `2**63`, `1e20`, `-0`, `1.5e-7` and `123.456` fixtures, and mutation 2.4(b).
- **CR3 (two-transaction mutation):** present in tasks 4.2 and 4.4. Re-verified that `DbContext.withSystemContext` is `privilegedDb.run(action.transactionally)`.
- **CR4 (lifted `++=`, never `#$`):** present in D-3. The cited precedent `PipelineRunRepository.scala:410` (`assertionsTable ++= rows`) exists.

### Independent review against the live tree
- **Migration number.** The latest migration is V114 (`V114__backfill_signup_completed_events.sql`), so V115 is the correct next number.
- **Column types.** `root_id` is `TEXT` on node_snapshots (V98:146), which matches D-1.
- **Write-path claims match the code.**
  - `NodeSnapshotRepository.overwriteRows` is at :106-137.
  - The only two `overwriteRows` callers are `PipelineRunService.scala:779` (backfill) and `:1418` (`onUnblockedRunSuccess`). No other code inserts into node_snapshots (grep).
  - `onRunSuccess` (:1253-1284) routes blocked runs to `onBlockedRun`, failed write-backs to `onWriteBackFailure`, and everything else to `onUnblockedRunSuccess`. Dry runs branch off at :1179.
  - `triggerSource` reaches `executeRun` (:988) but not `onRunSuccess`, as the design says.
  - `findConfigsByIdsInternal` exists at `OutputRepository.scala:156`.
- **Grantee fixture precedent.** A grantee needs a `resource_permissions` row with `resource_type = 'pipeline'` (V39:53-58). Existing tests that seed one: `PipelineSharingAclSpec.scala`, `ApiTokenAuthSpec.scala`.
- **Acceptance-criteria coverage, all traced to tasks:**
  - two runs give 2 rows and the five exclusions give 0 → 4.4
  - rollback → 4.2 and 4.4
  - cascade → 1.4
  - reducer fixtures, including string coercion → 2.1, 2.2, 2.4
  - RLS proof as `helio_app_test` → 1.3
  - guard, DML and Flyway specs → 1.2
  - one unit test per primitive → 3.2
  - cost measurement → 5.2
- **Rulings D1-D10.** D3's headline switch is explicitly deferred to L3/L5 in the Non-Goals, which is consistent with the L1 scope bullets. D4 tier caps and scheduling go to L2, D6 to L3, and D10 to L8.
- **Placeholders.** No TODO or TBD markers. The one "re-verify root_id type" instruction is already answered (TEXT, see above).

### Probe: 1-digit candidates for the subnormal group keys
```
node: 4e-324 -> MIN_VALUE true ; 5e-324 -> MIN_VALUE true
      9e-324 -> 1e-323 true   ; 1e-323 -> 1e-323 true
```
Both neighbouring 1-digit candidates parse back to the same double in each case. ES Number::toString then picks the one closest to the value (`5e-324`, `1e-323`).

### Verdict: CONFIRM

Both round-2 change requests are fixed in substance, the round-1 fixes still hold, and the design's claims match the live code. The one remaining imprecision (the first note below) is mechanically caught by fixtures the design already requires, so it does not block.

### Non-blocking notes
- **D-2 minimization tiebreak is unstated.** As the probe shows, for both subnormal cases BOTH 1-digit neighbours round-trip. "Use one if it parses back" leaves open which one. ES requires the candidate closest to the value. An implementer who tests the lower neighbour first would emit `4e-324` and `9e-324`. The `5e-324` and `1e-323` fixtures (Jest oracle) turn that red, so it cannot ship silently. The executor should implement "closest to the value", not "first that round-trips".
- **tasks 1.3 sharing fixtures.** `RlsSharingAwareTablesSpec` has only dashboard-sharing fixtures; it has no pipeline grant. The grantee case needs a `resource_permissions` row with `resource_type = 'pipeline'` (precedent: `PipelineSharingAclSpec`).
- **D-5 site count.** D-5 cites "19 `new ApiRoutes(` sites"; grep finds 25 lines. The parameter is defaulted, so this has no effect.
- **Unbounded `x` values.** D-2 series `x` is the raw cell JSON, which can be an arbitrarily large string or object. The 200-point cap bounds the count but not the per-point size. Consider truncating or recording this for L3. It is not required here.
