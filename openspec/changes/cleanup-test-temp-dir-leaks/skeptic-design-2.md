## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `dcc59552948c98dfac59f7ceab830b890cc6b737`. Re-derived every load-bearing
number from the tree myself rather than trusting round 1's figures or the revision narrative.

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/cleanup-temp-dir-leaks-in-tests/HEL-1120` (ambient is an ancestor of WORKTREE_PATH — expected, not a mismatch).
- **Artifacts read in full**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `workflow-state.md`, `skeptic-design-1.md`, plus `.concertino/laws/verification-before-completion.md`.

- **Inventory re-derived independently (CR1).** I did not check whether round 1's 59 was
  "copied in correctly"; I recomputed it from the tree with my own regex over all four
  spellings:

  ```
  $ grep -rnE 'createTempDirectory|createTempFile|createTempDir\b|Files\.createTemp' \
      --include=*.scala --include=*.ts --include=*.tsx --include=*.js \
      backend/src/test frontend scripts | grep -v node_modules | wc -l
  59
  $ ... | cut -d: -f1 | sort -u | wc -l
  39
  $ ... spelling breakdown:
       47 Files.createTempDirectory      (= 45 bare + 2 java.nio.file.Files FQN)
       10 File.createTempFile            (= java.io.File / bare File)
        2 Files.createTempFile
  ```

  **59 sites / 39 files confirmed**, all under `backend/src/test/scala` (no frontend or
  `scripts/` hits — the proposal's frontend non-goal is factually grounded). `design.md:4-6`
  states 59/39 and decomposes it as 45 + 10 + 2 + 2 = 59, which reconciles exactly with my
  independent breakdown. The count is now correct.

- **CR2 — guard covers all four spellings.** `design.md:70-77` (Decision 4) now names
  `Files.createTempDirectory(`, `Files.createTempFile(`, the FQN `java.nio.file.Files.*`
  forms, and `java.io.File.createTempFile(`/`File.createTempFile(`. The 10 sites round 1
  proved the old pattern MISSed are inside that set. Matching bare `File.createTempFile(`
  subsumes the `java.io.File.` form as a substring, so the stated coverage is achievable.
  `tasks.md` 2.1/2.4 carry the same four spellings, so the executor cannot implement a
  narrower guard and still tick the tasks.

- **CR3/CR5 — delete failures re-thrown, not swallowed.** `design.md:44-58` (Decision 1)
  now collects per-entry delete failures and re-raises them as an aggregated `afterAll`
  failure, explicitly rejecting round 1's "log and continue". I verified the concrete hazard
  it must survive: `LocalFileSystemSpec` strips write permission at lines 165, 181, 205, 225
  and restores at 173, 196, 213, 245. Those restores sit in `finally` blocks, so they run on
  a *failing* test too; the only path that skips them is a killed JVM, on which `afterAll`
  never runs either. So a re-throw is a sound response — a residual tree now surfaces as a
  red `afterAll`, which is the loud signal the AC needs, rather than a green suite over a
  leaked directory.

- **CR4 — prefix enumeration is actually complete.** I extracted every string literal passed
  to the 59 call sites and grouped them, rather than checking the list against round 1's:

  ```
  helio-* (47 distinct), analyze-concise-budget-spec, audit-mutation-instrumentation-spec[-csv-fail],
  csv-url-fetch-spec, csv-url-service-spec, hel1076-rls, hel914-ac1-e2e-spec, hel974-v100-spec,
  output-routes-shared, patch-set-{apply,preview,routes,undo,preview-routes,undo-routes}-*,
  pipeline-root-routes-spec[-no-output-repo]
  ```

  `tasks.md:45-46` lists `helio-`, `analyze-`, `audit-`, `csv-`, `hel1076-`, `hel914-`,
  `hel974-`, `output-`, `patch-`, `pipeline-` — every family above is covered, none missing.
  The 12 `createTempFile` sites contribute suffixes (`.png` ×4, `.csv` ×4, `.txt`, `.tmp`,
  `.probe`, `.pdf`) whose prefixes all fall in the `helio-` family, so they need no extra
  prefix. 12 suffixes for 12 `createTempFile` calls also cross-checks the 10 + 2 split.

- **CR6 — `:selftest` matches repo precedent.** `tasks.md` 2.2 adds
  `check:test-temp-dir-hygiene:selftest` planting one instance of each of the four spellings.
  I confirmed the precedent it claims to mirror is real: `package.json:16,19,22,25,27,29,31`
  ship `:selftest` companions for dependabot, openspec, precommit-ci-parity,
  node-root-encoding (×2), no-credential-leak, and tokens, with matching
  `scripts/*.selftest.mjs` files on disk.

- **Wiring target** (re-checked rather than inherited): `check-scala-quality.mjs` exists and is
  the stated pattern; the guard is wired into `.husky/pre-commit` and the CI `frontend` job with
  `check:precommit-ci-parity` kept green — consistent with how the six existing guards are wired.

### Verdict: CONFIRM

All six round-1 change requests are substantively implemented, and each one verifies against the
repo rather than against the revision narrative. The plan is implementable as written: the
inventory an executor will work to (59, four spellings) is correct, the guard can no longer be
blind to 10 real sites, the cleanup path fails loudly instead of silently, the evidence step
enumerates every prefix that actually exists, and the guard's failability is durable rather than
a one-off scratch commit. One residual defect is real but not load-bearing — see note 1.

### Non-blocking notes

1. **CR1 is implemented everywhere that matters, but not literally everywhere.**
   `proposal.md:3` still reads "and 46 other `createTempDirectory` call sites across 30+
   backend test files" — the exact stale string round 1 named. It now contradicts
   `proposal.md:16` ("the other 58 call sites") and `design.md:4` in the same change set.
   I am not blocking on it because the round-1 harm mechanism is closed: the executor's work
   list (`tasks.md` 1.3) and the authoritative Context both say 59/four-spellings, so nobody
   can be led to stop 12 sites short by a numeral in a motivational sentence. Fix it in the
   same pass — it is a one-line edit, and leaving a self-contradicting count in the proposal
   is the kind of thing a later reader cites as fact.

2. **Consider `setWritable(true)` before delete in the helper.** Decision 1 chose the
   "surface loudly" half of round-1 CR5 and dropped the chmod-restore half. That is defensible
   (analysis above), but attempting a permission restore while walking the tree would let the
   helper *succeed* on a read-only tree instead of correctly-but-unhelpfully going red. Pure
   robustness; the current design is not wrong.

3. **Carried forward from round 1, still unaddressed:** `PipelineStepRequiredConfigSpec.scala:30`
   constructs `new LocalFileSystem(Paths.get("/tmp"))`, pointing a filesystem at `/tmp` root.
   Outside the guard's pattern and outside the literal AC, but it writes into `/tmp` and
   belongs in the sweep's findings list the AC asks for.

4. `skip_specs: true` remains justified — no capability added or modified, no route/schema/wire
   change; test tooling plus a lint script only.
