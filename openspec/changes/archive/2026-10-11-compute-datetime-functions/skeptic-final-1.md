## Skeptic Report — final gate (round 1, skeptic-final-1.md)

- **Reviewed HEAD:** `0da1b93735978ecd2e2b2f8df344eb491b86adbd`. This is `3207b4d0a` plus a merge of origin/main.
- **Base:** resolved live with `resolve-review-base.sh` (rc=0) as `f4540f25d38d854746e93cce9c0efe90c5b01a3b`.
  - origin/main has since advanced 2 commits, to `02dc11abd`.
  - None of those files overlaps the branch's footprint, and `git merge-tree HEAD origin/main` is clean.
- **Worktree state:** clean apart from the untracked `evaluation-5.md`.
- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=feature/compute-datetime-arithmetic/HEL-1314`.

### What I verified (with evidence)

**Acceptance criteria, traced to code**

- **AC1: `seconds_between` is correct; null or unparseable input gives null; tests exist.**
  - The code is in `ExpressionDateTimeFunctions.secondsBetween`:
    - it computes `Duration.between(start, end)` as seconds plus nanos/1e9, plus `+ 0.0`;
    - an argument `parseInstant` cannot read gives `VNull`;
    - a null argument is handled by `applyFn`'s existing null guard.
  - `ExpressionDateTimeFunctionsSpec` covers:
    - ISO timestamps, fractions and sign, offsets, tz-less input as UTC, bare dates, leap days, DST, epochs and -0.0;
    - "null for a null argument";
    - "null for an unparseable argument without failing".
  - I ran it fresh: green.
  - The end-to-end run spec (`ComputeDateTimeRunSpec`: CSV, then cast, then compute, then a real `PipelineRunService.submit` on embedded Postgres) persists `[90, 0, null]`:
    - row 2 checks an offset conversion: 08:00 tz-less against 10:00+02:00 gives 0;
    - row 3 is unparseable and gives null, and the run still succeeds.
- **AC2: inferred types match applied types.**
  - `ExpressionTypeInference`:
    - `seconds_between` infers `float`;
    - `date_trunc` and `add_days` infer `timestamp`;
    - `+` with a `timestamp` operand infers `string`.
  - **Parity spec:** `ExpressionDateTimeInferenceSpec` iterates `DateTimeFunctions`. A guard asserts its case set equals the registry.
  - **Seam spec:** the run spec compares analyze's projected types with the persisted `node_snapshots` JSON kinds.
  - **Live check against my own servers:** a static source, then a cast to timestamp, then `seconds_between`. `/analyze` projects `queue_s: float` after `created_at`/`started_at: timestamp`.
- **AC3: documentation.**
  - **Editor help:** `ComputeFunctionReference.tsx` is a native `<details>`/`<summary>` disclosure listing all 14 functions. I saw it rendered; see the UI section.
  - **Grammar doc:** `docs/compute-expression-grammar.md` has function rows, inference rules, accepted shapes, examples, no `now()`, no `-` on timestamps, the Spark note and the known-limitation section.
  - **helio-mcp:** the `COMPUTE_EXPRESSION_DOC` constant is embedded in `add_pipeline_step`, `propose_pipeline` and `analyze_pipeline_proposal`. A test asserts all three embed it and that it names exactly the fixture's functions.
  - I ran the targeted jest suites fresh:
    - frontend `computeFunctionReference|ComputeFieldConfig`: 2 suites, 15 passed;
    - root `computeExpressionDescription`: 1 suite, 3 passed.

**The red I demanded: parity and seam tests fail under mutation**

I ran these in a scratch export of HEAD (`git archive`), never in the worktree. After reverting, `diff -r` showed the scratch tree byte-identical to HEAD, and it was green again (39/39).

| # | Mutation | Result |
| --- | --- | --- |
| M1 (infer side) | `date_trunc\|add_days => Right("string")` | RED. `ExpressionDateTimeInferenceSpec:33` fails with `date_trunc Right("string") was not equal to Right("timestamp")`. `ComputeDateTimeRunSpec:120` fails with `"[string]" was not equal to "[timestamp]"`. guard `failed=2` |
| M2 (apply side) | `seconds_between` yields `VStr(...)` | RED. The inference spec fails with `seconds_between kind mismatch: (float,Right("90.0"))`. The run spec fails at `:107` with `Vector("90.0", "0.0", null) was not equal to Vector(90, 0, null)`. guard `failed=3` |
| M3 (seam fixture) | `date_trunc` removed from `shared-test-fixtures/compute-expression-functions.json` | RED. `ComputeExpressionFunctionsSeamSpec:21` fails |
| M4 (D1 parser) | `case d: Double => None` | RED, on exactly the "whole Double epoch" characterisation row |
| M5 (`+` rule) | `TextLike = Set("string")` | RED. `ExpressionDateTimeInferenceSpec:52` fails with `Right("float") was not equal to Right("string")` |

So the parity tests can fail from both the infer side and the apply side, and the seam test fails on fixture drift.

**Datebucket, cast and WindowRolling characterisation**

- I ran the committed `DateBucketCharacterisationSpec` against the BASE code (`f4540f25d`, scratch export with only that spec added). Result: 27 passed, 5 failed.
  - The 5 failures are exactly the enumerated D1 delta rows: whole `Double`, exponent `BigDecimal`, `"1771286400.0"`, `"1.7712864E9"` and `"1e3"`. Each was `null` before.
  - Every unchanged row, and both `parseNonEpochDate` epoch-free rows, pass on base.
- **Code-level reasoning beyond the table.**
  - **Old vs new `parseToUtcDate`:** the epoch path, the trim, the threshold and the non-epoch chain are equivalent for every row value type the engine produces (`String`, `Double`, `Boolean`, `Long`/`Int` from casts, `compactPrint` strings).
  - **Cast:** it now passes the raw value, and its only new acceptance is the same whole-number class.
  - **WindowRolling:** it consumes only `parseToUtcDate`, so it inherits the same delta. That is pinned by `TimestampAgreementSpec`'s rolling-days row.
  - **One unenumerated edge, non-blocking:** the string `"-9223372036854775808"` (Long.MinValue). The old code threw: `math.abs` of MinValue is negative, so it reached `ofEpochSecond(MinValue)` and threw a `DateTimeException` out of the step. The new code reads it as epoch millis. This is a crash turned into a value, not a regression.

**The `+` timestamp→string inference: was it ruled, and is it documented accurately?**

- **Ruling:** `events.jsonl` line 19 records `escalation.answered answer=A-ship-document-spinoffs` (`answer_source: human`), against the raise on line 18. Option A was "ship as designed, document the two residual paths in the grammar doc, and file spinoff tickets".
- **Shipped:** the change is in `ExpressionTypeInference` (`TextLike`).
- **Documented:** the grammar doc has a "Known limitation: a timestamp-typed column that carries a number" section naming both paths. Both are accurate against `timestamp-paths-evidence.md` and the probe transcript:
  - fillnull mean/median, where the schema stays `timestamp` and the filled cells are Doubles;
  - a union whose parent's `timestamp` type wins over a numeric secondary field.
- **Spinoff filed:** Linear shows HEL-1314 `relatedTo` HEL-1491 ("Type bugs that put numbers under a timestamp type: fillnull mean/median ...; union keeps the parent's timestamp type ...").

**Clean seams for HEL-1070**

- One object per function family (`ExpressionDateTimeFunctions`, documented as the pattern), plus a registry vector (`DateTimeFunctions`) and a single delegating `applyFn` case.
- `checkCall` gives per-call argument checks a general hook.
- The `NumericFunctions` partition test now subtracts each family explicitly, so a new family must be classified.
- `Val` visibility was widened only to `private[engine]`.
- There is no speculative function-table refactor.

**Hygiene**

- **No inline FQNs:** grep of the `+` lines in the Scala diff, excluding imports and comments, found 0 hits.
- **Embedded Postgres:** the only new DB spec, `ComputeDateTimeRunSpec`, uses `VerifiedEmbeddedPostgres.start`.
- **Guard line, `cycle5-testFull.txt`, line 78750:** `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, with 7063 succeeded and 0 failed.
- **Guard line, `eval5-backend-testFull.txt`:** the same result.
- **My own sbt runs:** every one printed the guard line.

**Unrelated leakage**

- `git diff --stat base...HEAD` shows 52 files, all in the change's footprint: the engine, the steps, their specs, the docs, the compute editor, helio-mcp, the fixture and the change dir.

**Commits**

- `git log --format=%B base..HEAD` has no `claude.ai`, `session` or `Claude-Session` hits.

**UI judgment**

- **Setup:**
  - servers came from `start-servers.sh` on 6746/9653, and `assert-phase servers` PASSED;
  - I used an isolated Playwright Chromium context, not the shared MCP browser;
  - I captured 1440 desktop and 375 touch, each in light and dark, with the list closed and open.
- **Tokens and parity:**
  - every value is a token (`--text-xs`, `--app-text-muted`, `--control-sm`, `--space-*`, `--app-radius-sm`, `--font-mono`, `--app-focus-ring`);
  - the recipe matches the sibling `.usage-card__summary`;
  - computed colours flip correctly in both themes: summary `rgb(100,94,86)` / `rgb(170,164,156)`, code `rgb(33,29,25)` / `rgb(242,239,233)`.
- **Visual review:**
  - the disclosure sits between Expression and "Available fields", collapsed by default;
  - the chevron rotates when opened, and the mono signatures with muted glosses read clearly;
  - nothing an experienced eye would reject.
- **Console:** there was one 404, which I traced to `GET /api/pipelines/:id/schedule` (the pre-existing "No schedule set" path). It is unrelated to this change.
- **Dev-DB cleanup:** rows were deleted by exact id, each returning 204. Afterwards the pipelines return 404 and the sources are no longer listed.
  - pipelines `947ab9de-bd68-4711-87a8-b57a91880a6c`, `37c2d248-5689-43b8-befe-c3403535a093` and `dfb8515f-d0e7-4154-835d-24ebe7dccd65`;
  - sources `2bdd5233-8d68-4577-aae3-a120b487ec96`, `b81d8fef-f9d4-4091-8323-029801c68fb5` and `4622e745-340a-46c2-bc10-c34a7892f131`.
- **Shutdown:** servers were stopped by exact PID (2402822, 2402679, 2402637, 2403097, 2403043), and the ports are free. No sbt process is left with a cwd in my scratch dirs.
- **Evidence:** the screenshots and mutation transcripts are in the session scratchpad, so they are not durable. `persist-evidence.sh` only accepts sources inside a git working tree. The load-bearing output is quoted inline above, so this report stands on its own.

**Gate-defect check (CON-160):** no report I relied on rests on mtime ordering. None recorded.

### Verdict: CONFIRM

### Non-blocking notes

- **`timestamp-paths-evidence.md` ends with a stale conclusion.** It says "the `+` inference change (tasks 3.3) has NOT been made", which contradicts the shipped code and `red-evidence.md` Group 3 green. Before archiving, append one line recording the A-ship-document-spinoffs ruling, the change being made, and HEL-1491.
- **The spec delta does not carry the caveat.** The `compute-expression-language` delta states the `+` rule without the fillnull/union caveat that the grammar doc carries. A one-line pointer, optionally citing HEL-1491, would keep the spec honest.
- **The grammar doc's known-limitation section could cite HEL-1491** so a reader can find the fix.
- **Function-list rhythm:** the gap inside an item (signature to gloss) equals the gap between items (`--space-1` both), so the grouping between entries is weak. A larger between-item gap, such as `--space-2`, would group each signature with its gloss. This is polish, not off-pattern.
- **Shared recipe candidate:** as the evaluator noted, the summary recipe duplicates `.usage-card__summary`. A shared disclosure-summary recipe is a spinoff candidate.
- **Unenumerated edge:** the Long.MinValue epoch string, described in the characterisation section. It changed from a thrown step failure to a parsed date.
- **Shared scratchpad side effect.** My first export went into a pre-existing shared scratchpad dir (`scratchpad/mut`, other agents' files from 06:31). It overwrote that dir's tracked-file copies with HEAD content. Nothing in the worktree or the repo was affected. Everything after that used the dedicated `skeptic-hel1314-*` dirs.
