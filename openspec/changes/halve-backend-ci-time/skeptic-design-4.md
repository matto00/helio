## Skeptic Report - design gate (round 4, skeptic-design-4.md)

Reviewed head 517b98ea928e4d6efb541e406652dcec0de3e5e8 (planning artefacts as edited in the working tree). No push, CI rerun or suite run.

### Round-3 change requests
1. proposal.md cache bullet: RESOLVED. It now reads "Keep the sbt dependency-cache key identical to main's; cache compile output, restored on every run and saved only by a push to main from shard 0", matching D7, tasks 3.4/7.3. Ground truth: `git show origin/main:.github/workflows/ci.yml` uses `sbt-${{ hashFiles('**/build.sbt') }}` (lines 152/195/384), which is what D7 mandates. The branch ci.yml line 166 still has the widened key; tasks 3.4/7.3 are unchecked and own the revert (correct for a design gate).
2. proposal.md Non-goals: RESOLVED. Now "No change to the e2e job (HEL-1288 owns it); no change to frontend or security beyond job-level timeout-minutes", consistent with D11/C7 and ticket owner scope 2.

### Cold whole-plan check
- ACs traced: profile (1.x), counts + ledger (2.x, 6.2, spec), HEL-1228 guards (C2, 6.3), 5.5 min median post-merge only (D8, honest), no .sbtopts (C7), HEL-1292 not folded (D4, conditional respected). Owner scope: concurrency (D10, 7.1, 7.5), timeouts (D11, 7.2), cache (D7, 7.3, 7.4) all covered; spec delta covers sharding exactly-once, gating, removal ledger, profile, concurrency, timeouts.
- D10 per-run_id group for main is correct per documented GitHub semantics (one pending run per group; older pending is cancelled even with cancel-in-progress false). max-parallel 4 = leg count, honestly stated as non-throttling.
- D7 save-on-main-only / D8 cold-pre-merge reasoning is internally consistent; the acceptance split is disclosed, not hidden. No ESCALATION-worthy ambiguity.
- No TODO/TBD placeholders; tasks have verification signals.

### Verdict: CONFIRM

### Non-blocking notes (cleanup recommended, not gating; tasks/C7/D11 are binding and explicit)
- design.md Goals/Non-Goals still lists "the e2e/frontend/security jobs" as unchanged; amend to "e2e job; frontend/security beyond job-level timeout-minutes" for consistency with D11/C7.
- proposal.md Impact says ci.yml "backend job only, plus ci-complete if its needs list must change"; it also gets the workflow-level concurrency stanza and timeout-minutes on frontend/security/ci-complete.
- Prefix hazard: dependency `restore-keys: sbt-` also prefix-matches the new `sbt-compile-v2-...` entries; on a build.sbt-hash miss the dependency step could restore a compile entry. Low impact, but consider naming compile entries outside the `sbt-` prefix (e.g. `compile-v2-`) or note it for HEL-1299.
- From round 3, still applicable: PR text should say warm evidence is an exact-hit best case, steady-state main is partial-hit, per-merge entry growth is HEL-1299's; flag the first post-merge main run as cold in the 5-run median.
