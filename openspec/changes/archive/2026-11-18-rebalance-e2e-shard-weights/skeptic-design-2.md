## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md (change dir untracked) at worktree HEAD
80cab1f7aa5559bafc3826cd9072b68ba651c195. Ground truth: `openspec/specs/e2e-ci-sharding/spec.md`,
`scripts/e2e-shard.mjs`, `e2e/shard-weights.tsv`, `.github/workflows/ci.yml` (e2e job),
`.concertino/scratch/HEL-1772/main-leg-times.tsv`, `.concertino/runs/HEL-1772/evidence/premise-validation.md`, and the
GitHub API (live queries, 2026-11-18).

### What I verified (with evidence)

1. **Round-1 CR1 (spec "e2e shard balance is measured in CI") — RESOLVED.** design.md Decision 3 now names the
   requirement, commits Delivery to its format (25-run counting before set with exclusions listed; at least 5
   counting after runs; per-leg median and max of whole leg and test step; the imbalance metric defined exactly as the
   spec defines it), and states the two unmet/not-applicable parts openly: (a) no count-based control set exists,
   (b) the 15 s line. The 20-minute requirement's main-branch definition is addressed: PR runs are the ticket's proof,
   a post-merge main watch is reported at Phase 4 and not claimed as met until 5 runs exist. tasks.md section 3
   mirrors it.
2. **Round-1 CR2 (before figures) — RESOLVED.** Re-counted from `main-leg-times.tsv`: e2e (6) slowest in 6 of 11
   (44391395102, 44375091328, 44369179186, 44353873500, 44328417748, 44288728787); leg 4 at 1377/1396/1443 s (three
   runs; in 44295142906 leg 4 at 1443 beats leg 6 at 1437). design.md Context and premise-validation.md line 5 both now
   say this; no "7 of 11" or "twice" remains in proposal/design/tasks. Leg-6 range 1096-1519 s and overhead 150-230 s
   (e.g. 941-790=151, 857-636=221) check out.
3. **The 25-run before set is feasible.** Artifact `retention-days: 14` (ci.yml e2e job). Walking main push CI runs
   newest-first via `/runs/{id}/attempts/{n}/jobs` + `/runs/{id}/artifacts`, 26 counting runs (all 6 e2e legs
   `success`, 6 unexpired `playwright-json-shard-*`) exist back to 44035452762 (2026-11-17), all well inside retention.
   Excluded runs (cancelled 44369179186, 44281084753; failed 44296217514, 44271692192, 44253322509, 44252041089,
   44140787912) are detectable exactly as the design says. Data: `.concertino/scratch/HEL-1772/skeptic/main-runs-r2.tsv`.
4. **Zero-defaulted goal is reachable.** `weightsFromRuns` (e2e-shard.mjs ~161) takes the median over the runs a file
   appears in, so any spec present in at least one source run gets a row. `git diff --name-status` from 44391395102's
   head (56b4ae1ff) to the base 80cab1f7a touches only two existing specs (M) and adds none, so every spec discovered on
   the base ran in that source run. The four specs added after 44350387897 (hel1738, hel1752, hel1762, hel1763) will be
   weighted from fewer than 5 runs (see notes).
5. **Tooling claims hold.** `validateRunReports` rejects missing/unexpected/flaky reports (e2e-shard.mjs:176-191);
   `plan` prints defaulted and stale rows (232-244); unknown weight = median of discovered rows (56-70). Table header
   shows last regen from runs 39477341305..39689629368 (HEL-1667), confirming staleness.
6. **Rerun mechanics.** PR run 44316392050 (attempt 2) shows a rerun uploads a second `playwright-json-shard-6`
   artifact under the same name (ids 14434716188, 14436542330), so per-attempt reports exist and are distinguishable
   by creation time; the per-attempt jobs endpoint the design cites is correct.
7. **Base-head run 44403971270** is still `in_progress`; tasks 1.1 keeps it conditional. Decision 2's LPT wording no
   longer claims a headroom guarantee (round-1 note addressed). Round-1 non-blocking notes (run-wide slowdown/mean leg,
   out-of-sample check, per-attempt jobs, naming measurement reruns) are all incorporated.
8. Scope: data file + one ci.yml comment; no `timeout-minutes`, matrix, script logic, cd-*.yml, HEL-1743/HEL-1732 files.
   Every AC maps to a task (measure/cause: Context + 1.3; fix: 1.1-1.2; three-plus runs with headroom: section 3).
   No placeholders or contradictions found.

### Verdict: CONFIRM

### Non-blocking notes

- **Rerun command is under-specified.** "literal `gh run rerun` of the e2e jobs" can be read as six separate
  `gh run rerun --job` calls (GitHub runs one job per attempt that way, and a new rerun cannot start until the previous
  attempt completes, so the six legs would not run concurrently: different runner contention, six times the elapsed
  time) or as one whole-run `gh run rerun <runId>` (all legs concurrent with the backend legs, which is how a normal run
  looks). Use the whole-run form and say so in the PR, so each attempt is comparable with the before set.
- **15 s line framing.** The HEL-1361 owner acceptance was for HEL-1361's result. The design discloses the gap rather
  than hiding it, which is enough for this gate, but the PR should present it as a gap this change still carries
  (with the number), not as a waiver inherited from HEL-1361.
- Specs added after 44350387897 (hel1738, hel1752, hel1762, hel1763) get weights from 1-4 runs, and hel1608 changed
  after every source run except the base-head one. List these in the PR as thinly-sampled rows, as the Risks section
  already intends for changed specs.
- When counting PR after-set attempts, tie each `playwright-json-shard-*` artifact to its attempt (artifact creation
  time between that attempt's job start/end) so "every leg's report is present" is checked per attempt, not per run.
