## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `e114682d689df50f0cb341070bf3c4463755ea7a` (worktree clean apart from the untracked evaluation-*.md).

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=bug/compute-numeric-warning-gaps/HEL-1455`.
- **Base, resolved live**: `resolve-review-base.sh` rc=0 → `8e18ed5459814fdc43143f8411c04494ba36a8c2`, which is the merge-base with origin/main (`ea04f2aa2`, HEL-1502 merged). `git merge-tree --write-tree origin/main HEAD` gives rc=0 with no conflicts.
- **HEL-1502 / C2 / AC8 isolation**: the set of files changed by 8e18ed545..ea04f2aa2 and the set changed by BASE...HEAD do not intersect (`comm -12` output is empty). No file named TimestampParsing, ExpressionDateTimeFunctions, CastStep or DateBucket is in the branch diff. The only date-adjacent edit is in `ExpressionParser.scala`, where the existing `date_trunc` `parseArgs` call is wrapped in `nested(...)`. That is depth accounting only; the date_trunc unit-message mapping is unchanged. HEL-1502's CastStep edit only touches the date/timestamp branch, and `SupportedTargets` (used by `castTrusted`) is unchanged, so this branch's cast-trust logic does not interact with it semantically.
- **Runtime semantics behind the warnings** (`ExpressionInterpreter.scala:133-210`): `-`, `*` and `/` on a VStr raise a TypeError. `length`, `lower`, `upper` and `substring` raise a TypeError on a VNum first argument and on non-VNum start/end. `+` with a VStr or VBool operand concatenates. So every new warning's claim that every row computes null is true, and `string-body` → VStr makes the item-1 inference change (`$sb + 1` infers `string`) correct. design.md Decision 1 records this projected-type change.
- **Targeted backend suites, run by me** (`nice -n 19`, Xmx 3g, testOnly over ComputeTypeWarningsSpec, ExpressionDepthLimitSpec, NumericOpOnTextFieldWarningSpec, *AnalyzeSchemaWarnings*, ExpressionEvaluator*, *TypeInference*, *Parser*): `Tests: succeeded 251, failed 0`, `All tests passed`. I relied on the evaluator's pasted `sbt testFull` result (7655 passed, 0 failed) and its two mutation runs. Both are unambiguous, and the cycle-2 mutation shows the CR1 and CR2 regression tests are failable.
- **Contracts (AC6)**: `check:helio-mcp-types` rc=0, `check:schemas` rc=0, `npm run typecheck` rc=0. The diff adds the two codes to the schema enum, the frontend `AnalyzeWarningCode` union, `helio-mcp/src/types.ts` and three tool descriptions. A grep shows `AnalyzeWarningCode` is used only in `pipelineStep.ts`, so no per-code switch exists and rendering stays generic.
- **Live behaviour** (servers started with `start-servers.sh` and `assert-phase.sh` → `PASS servers` on 6887/9794; throwaway user `skeptic-hel1455-1791877743@example.test`; finance template; `POST /api/pipelines/analyze-proposal` with chained steps):
  - AC2: compute(`total = $amount_usd * 2`) → compute `floor($merchant)` warns `numeric-op-on-text-field` on `merchant` at s1. A compute-written column (`t = concat($merchant)`, then `floor($t)`) stays silent, and so does a compute that overwrites `merchant`. A rename of an untrusted column (`t`→`u`, then `floor($u)`) stays silent, so trust is carried through the rename.
  - AC3: cast `amount_usd`→`float` then `floor($amount_usd)` is silent. A legacy `string-body` cast then `floor($amount_usd + 1)` is silent (untrusted). After `fillnull`, `floor($merchant)` is silent.
  - AC4a: after a float cast, `length($amount_usd)`, `upper(-$amount_usd)` and `substring($amount_usd,0,2)` each give `text-function-on-numeric-field`. It still fires after an unrelated compute (per-column trust). `length($amount_usd + "x")` is silent. `substring($merchant, $category, 2)` gives `numeric-op-on-text-field` on `category`.
  - AC4b / C1: `"3" * 2` and `length(5)` give `literal-type-mismatch` and no validationError. `"a" - 1` after a `fillnull` (untrusted input) still warns, because the literal check needs no trust. Literals behind `if`, `coalesce` and a comparison are silent.
- **AC5 depth limits, live via `POST /api/pipelines/:id/validate-expression`** (every response was HTTP 200, never a 500):
  - At 100 levels, unary `-`, `(`, `not` and `floor(` are all valid; at 101 each returns the nesting message. A mixed `(-` nest is valid at 50 pairs (100 levels) and rejected at 51.
  - A flat `+` chain is valid at 200 terms. At 201 terms and at 20000 terms it returns the tree-depth message, and so does a flat chain of 300 `and`s.
  - The legacy grammar returns the nesting message for 101 and 20000 brackets and for 5000 unary minuses, and the tree-depth message for a 300-term `x + x …` chain.
  - `(x) + 1` still returns `Expected closing ')'`, so the cycle-1 CR1 regression is fixed live.
  - `LegacyParser` (`ExpressionParser.scala:287-330`) recurses only through brackets, and `maxParenDepth` covers that recursion.
- **AC2b**: `lookupKeyWarnings` and `joinKeyWarnings` now gate on `columnTrusted(in, key) && columnTrusted(s.flags, key)` (AnalyzeSchemaWarnings.scala:192, :227). A join or lookup whose secondary has untrusted columns drops its output to `types=false`, which is conservative. The suites I re-ran cover these cases.
- **AC7**: checked read-only through `e2e/support/db.cjs` `psql`. The count of users with `id='21d2ffee-a560-47e5-a97b-e370153ac6c9' OR email LIKE 'skeptic-hel1403-%@example.test'` is `0`.
- **Teardown of my own probe data**: I deleted my user by exact (id, email) with `buildUserDeleteSql`: before 1, after 0, template pipeline rows left 0. I stopped the servers with `stop-servers.sh` → `STOPPED ports=6887,9794`.
- **UI / design judgment**: not applicable. The only `frontend/**` change is a TypeScript string-literal union, with no markup, CSS or token change, so there is nothing to judge visually. I took no screenshots, and this report's verdict rests on none.
- **Gate-defect check (CON-160)**: neither evaluation report relies on mtime ordering. Not applicable.

### Verdict: CONFIRM

### Non-blocking notes
- Item 1 changes the inferred type of `$sb + 1` from `float` to `string`. That is correct at run time, and design.md Decision 1 records it. One side effect: a stored expression such as `if(c, $sb + 1, 0)` or `$sb + 1 > 3` that validated before now gets a common-type or comparison validationError when analyzed again. Each of these computed null or raised a TypeError on every row before, so this tightens a silent failure; it does not break working data. Worth one line in the PR body.
- `ComputeTypeWarnings.textFunctions` filters `untrusted` a second time, which is redundant (the evaluator noted this too).
- Pre-existing and not from this diff: a compute that overwrites an existing column (`column: "merchant"`) shows `merchant` twice in the proposal's projected output schema. Consider a separate follow-up if that is not already known.
