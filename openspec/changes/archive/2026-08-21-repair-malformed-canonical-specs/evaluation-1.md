## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `a8234482`, base `8432f280` (== `origin/main`; `git merge-base HEAD origin/main`
equals `git rev-parse origin/main`, so AC6's "merged up to current main" holds).

All evidence below is from my own fresh runs, not from the executor's report. Sandbox copies of the
tree were used for every `openspec archive` probe; the real worktree tree was never archived and
nothing under `openspec/changes/` outside this change dir was touched.

---

### Phase 1: Spec Review — PASS

**AC1 — malformed files enumerated mechanically, prior counts reconciled.** Reproduced independently.
I extracted the base tree (`8432f280`) into a sandbox and ran two independent malformation conditions
across all 317 canonical specs:

| Condition (on the unrepaired baseline) | Count |
| --- | --- |
| requirement-name sets disagree (parser vs validator vs in-file) | 25 |
| `openspec validate --specs` reports invalid | 24 |
| **union** | **26** |
| files this commit repaired | **26** |

The union is *exactly* the set of 26 files repaired — zero in the union not repaired, zero repaired
not in the union. The "26, not 22" correction is therefore correct and not an over-reach. The
delta-only-heading grep flags 22 on the same baseline (21 `ADDED` + `resource-metadata`'s `MODIFIED`),
which reconciles with HEL-548's refined figure of 21 plus the already-repaired 22nd
(`frontend-panel-empty-state`), exactly as design.md claims.

**AC2 — the load-bearing question settled by test.** Reproduced independently. I renamed only the
`## ADDED Requirements` heading in an unrepaired `dashboard-delete` (no Purpose added) and ran a real
`openspec archive` with a `MODIFIED` delta:

```
✗ Spec must have a Purpose section. Missing required sections. ...
Aborted. No files were changed.
```

The bare rename is insufficient, as the proposal states. I also confirmed the ticket's framing is
wrong about `ADDED`-only deltas: an `ADDED`-only delta against unrepaired `panel-ordering` aborts on
the same Purpose error.

**AC3 — every requirement, scenario and ordering preserved.** Verified mechanically, not by eye. I
hashed every full requirement block (from `### Requirement:` up to the next line matching
`/^(##|###)\s/`, so `#### Scenario:` blocks and their `- **WHEN**`/`- **THEN**` bullets are *inside*
the hash) for all 317 specs at both `8432f280` and `a8234482`:

- 317 files at base, 317 at HEAD — no file added or removed.
- **1476** requirement blocks at base, **1476** at HEAD — no requirement gained or lost.
- Ordered requirement-name list identical in **all 317** files.
- Block hashes identical everywhere except **one** block: `schema-inference` ::
  `InferredSchemaResponse wire format` (`e1294cc7029bca87` → `bd627d00fd21df14`) — precisely the
  single human-approved exception (design.md 3a / tasks.md 10). No second difference anywhere.

Corroborated at the line level: across the whole `openspec/specs/` diff the only changed
`###`/`####`/`- **WHEN**`/`- **THEN**` lines are the three lines of that approved scenario. Every other
changed line is a `## `-level heading or part of a prepended `## Purpose` block, satisfying task 6.2.

**AC4 — guard proven to fail red.** See Phase 2.

**AC5 — in-flight repairs verified, not assumed.** Neither file is in the repair set (correct — neither
is touched by this commit) and both are clean on the repaired tree:
`shared-status-message` (`## Purpose` :1, `## Requirements` :6) and `frontend-panel-empty-state`
(`# Title` :1, `## Purpose` :3, `## Requirements` :7) both report
`Specification '<id>' is valid`.

**AC6 — repairs made against a tree merged up to current `origin/main`.** `merge-base HEAD origin/main`
== `rev-parse origin/main` == `8432f280`. No merged capability change is reverted: the 1476-block
comparison above would have caught any such revert, and it found exactly one licensed difference.

**The added scenario asserts nothing new (design.md 3a constraint 1).** Word-by-word:

- Requirement's own SHALL sentence: "`POST /api/sources/infer` and `POST /api/data-sources/infer`
  SHALL both return the same response envelope: `{ "fields": [...] }`."
- Added scenario **WHEN**: those same two endpoints "are each called" — the subject of the SHALL,
  restated as a trigger.
- Added scenario **THEN**: "both return the same response envelope" + the envelope literal.

The envelope literal in the scenario is **byte-identical** to the one in the SHALL sentence
(programmatically compared, not eyeballed). No expectation appears in the scenario that is absent from
the SHALL sentence — no status code, no error case, no field semantics, nothing invented. The text also
matches tasks.md 10.1's mandated wording verbatim. Constraint 1 is satisfied.

**Task-list fidelity.** 32 of 33 items checked; the single unchecked item is 9.4 ("At archive time,
hand-write the `## Purpose` for the new `openspec-spec-hygiene` spec"), which is by definition a
Phase-3/archive action and is called out in `files-modified.md`. Correct to leave open.

**Spec delta accuracy.** All five requirements in
`openspec/changes/repair-malformed-canonical-specs/specs/openspec-spec-hygiene/spec.md` describe what
actually shipped, and I verified each of their scenarios empirically (see Phase 2 fixture table).
`openspec validate repair-malformed-canonical-specs --type change` → valid.

**Scope.** No scope creep. 26 spec files + 1 new script + 2 one-line wiring lines + this change's own
directory. Nothing outside `openspec/specs/`, `openspec/changes/repair-malformed-canonical-specs/`,
`scripts/`, `package.json`, `.husky/pre-commit`. No `frontend/**` or `backend/**` file touched, so no
runtime behavior change is possible.

**Task 10.4 (further scenario-less / SHALL-less requirements).** Re-scanned all 1476 requirements on the
repaired tree myself: **0** scenario-less, **0** SHALL/MUST-less. The approved exception was the last one.

Issues: none.

---

### Phase 2: Code Review — PASS

#### Gates (my own fresh runs, in `WORKTREE_PATH`)

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 — "All matched files use Prettier code style!" |
| `npm test` | exit 0 — 254 suites / 2751 tests passed |
| `npm run check:spec-structure` | exit 0 — "spec-structure check passed (317 canonical specs, 0 issues)" |
| `npm run check:openspec` | exit 0 — "openspec/ is clean" |
| `npm run check:schemas` | exit 0 |
| `openspec validate --specs` | **317 passed, 0 failed** (task 6.3, on a clean sandbox copy of HEAD) |

`npm --prefix frontend run build` and `cd backend && sbt test` are **N/A**: `git diff --name-only
main...HEAD` contains no path under `frontend/**` or `backend/**`.

`git status` in the worktree is clean — no probe artifacts or temp fixtures leaked into the repo
(task 9.3). All my own sandboxes live under the session scratchpad, outside the repo. No stray git
worktrees were created.

#### 3. The guard actually fails red — verified against fixtures I built myself

Each fixture was run in **isolation** (its own directory) so I could confirm the guard names the
offending file individually. All under the scratchpad, never `openspec/specs/`.

| Fixture | Guard exit | Message |
| --- | --- | --- |
| control: well-formed spec | **0** | "spec-structure check passed (1 canonical specs, 0 issues)" |
| raw delta file (`## ADDED Requirements`, no Purpose) | **1** | names file; stray heading + sets disagree + validator "Spec must have a Purpose section" |
| well-formed + appended hidden `## ADDED Requirements` section | **1** | names file; "hidden from delta parser: Gamma behavior; hidden from validator: Gamma behavior" |
| `## Purpose` deleted | **1** | names file; validator's own "Spec must have a Purpose section" |
| stray `## MODIFIED Requirements` | **1** | names file; stray heading + both requirements hidden + "Spec must have a Requirements section" |
| **requirement after a level-1 `#` heading inside the requirements body** | **1** | names file; "requirement-name sets disagree (hidden from validator: Beta behavior)" |
| duplicate requirement name | **1** | names file; "duplicate requirement name(s): Alpha behavior" |

Two extra edge cases I added beyond the plan, both caught: a spec with an **empty** `## Requirements`
section (validator ERROR "Spec must have at least one requirement"), and a requirement hidden behind a
trailing `## Notes` heading (sets disagree).

**The set-equality invariant is genuinely load-bearing, not decoration.** I pointed the real
`openspec validate --specs` CLI at a mini-project containing three of the malformed fixtures:

```
f2-appended-hidden:  valid=True
f5-hidden-behind-h1: valid=True
f6-duplicate-name:   valid=True
CLI exit=0
```

The naive "just run the validator" check passes all three; the guard catches all three. Design
decision 3's rejection of a validator-only or heading-only check is empirically correct.

**Robustness.** Guard runs correctly from an arbitrary CWD (resolves its own repo root from
`import.meta.url`). With `openspec` absent from `PATH` it exits **2** with
"Cannot find the `openspec` CLI on PATH …" rather than throwing ENOENT or passing silently — mirroring
`check-openspec-hygiene.mjs:28`, as design decision 3 requires. Under the hook's `set -e`, exit 2
blocks the commit, so the fail-loud property holds.

#### 4. The tasks.md 7.1 deviation is genuinely equivalent

The guard calls the imported `Validator.validateSpec(path)` per file instead of shelling out to
`openspec validate --specs`. I verified equivalence two ways.

*By source.* `dist/commands/validate.js`'s `runBulkValidation` does, for each spec id from
`getSpecIds()`, exactly `validator.validateSpec(path.join(cwd,'openspec','specs',id,'spec.md'))` on a
`new Validator(opts.strict)`. That is the identical method the guard calls. `createReport` sets
`valid = strictMode ? (errors===0 && warnings===0) : errors===0`; the CLI defaults `strict` to false and
the guard constructs `new Validator()` (also false), so the CLI's pass predicate is exactly the guard's
`issues.filter(i => i.level === "ERROR").length === 0`. Directory enumeration differs cosmetically
(`getSpecIds` skips dot-dirs and requires `spec.md`; the guard iterates subdirectories and `continue`s
when `spec.md` is unreadable) — same outcome on this corpus.

*By experiment, on the discriminating corpus.* The repaired tree is uniformly clean and cannot tell a
correct implementation from a vacuous one, so I ran both against the **unrepaired** baseline:

- `openspec validate --specs` on `8432f280`: **24** invalid specs.
- The guard's validator half pointed at the same unrepaired specs dir: **24** files flagged with
  "openspec validator reports ERROR(s)".
- `diff` of the two sorted id lists: **identical**.

The deviation loses nothing and buys a real capability the plan's version could not have: the guard
self-tests against fixture directories outside a scaffolded openspec project, which is exactly how
task 7.4's red-before-green proof was obtained above. Judged **equivalent and an improvement**. It is
documented at the point of use in the script header (lines 22–30).

Separately, the guard's fidelity to task 7.2 checks out: on the unrepaired baseline it reproduces
**25** files with disagreeing requirement-name sets, exactly the figure the plan predicted.

#### 5. Archive actually works now — asserted on stdout, never on `$?`

All probes in sandbox copies; `Aborted` absence and `Specs updated successfully` presence checked as
strings. The control probes confirm archive's exit-0-on-abort behavior first-hand (`shell exit=0`
while printing `Aborted. No files were changed.`).

| Probe | Tree | Result |
| --- | --- | --- |
| `MODIFIED` vs `dashboard-delete` (Class A) | **repaired** | "Specs updated successfully." / no `Aborted` |
| `MODIFIED` vs `dashboard-delete` — control | unrepaired | `MODIFIED failed for header "### Requirement: Dashboard can be deleted via DELETE endpoint" - not found` / `Aborted.` (shell exit 0) |
| `REMOVED` vs `schema-inference` (Class B, 8 reqs) | **repaired** | "Specs updated successfully." / no `Aborted` |
| `REMOVED` vs `shared-inline-error` (Class B, 6 reqs) | **repaired** | "Specs updated successfully." / no `Aborted` |
| `REMOVED` vs `schema-inference` — control | unrepaired | `REMOVED failed for header … - not found` / `Aborted.` |
| `ADDED`-only vs `panel-ordering` (Class A) | **repaired** | "Specs updated successfully." |
| `ADDED`-only vs `panel-ordering` — control | unrepaired | `✗ Spec must have a Purpose section` / `Aborted.` |
| rename-heading-only vs `dashboard-delete` (AC2) | rename-only | `✗ Spec must have a Purpose section` / `Aborted.` |

The `REMOVED` probes correctly target multi-requirement Class B capabilities, avoiding the
single-requirement "Spec must have at least one requirement" false failure.

**Task 8.2 — text intact after archive.** After the `MODIFIED` archive, `dashboard-delete`'s untouched
requirement block is byte-identical to HEAD (the modified one differs by design, carrying the probe
marker). After the `REMOVED` archive, `schema-inference` retains 7 requirements and **all 7 blocks are
byte-identical to HEAD**, including the approved-exception requirement with its new scenario.

#### 6. The 24 authored `## Purpose` blocks — all 24 read against their own requirements

I read every one of the 24 (Class A ×19, Class C ×3, Class D ×2) side by side with that file's
requirement names and SHALL/MUST bodies. **None asserts behavior its requirements do not support, and
none misdescribes its capability.** Each is a faithful summary at the right altitude, and each clears
the 50-character WARNING threshold.

Three that summarize more than the bare requirement headings do, and which I therefore checked against
the full requirement bodies rather than the headings:

- `dashboard-duplication` — Purpose claims "copies appearance, layout, and panels with remapped IDs".
  Supported verbatim by the requirement body: "copying the source dashboard's `appearance` and
  `layout` … duplicates all panels … with new UUIDs … All panel ID references in the copied layout
  SHALL be remapped".
- `frontend-dashboard-selection-flow` — Purpose claims "preserving an existing valid selection" and
  "driving lazy per-dashboard panel loading". Both are scenarios in the file ("Existing selection is
  preserved when still valid"; "Panel loading remains lazy and selection-driven"), not inventions.
- `user-preference-update` — Purpose names "(zoom level, accent color)" and "updating only the fields
  listed in the request". All three claims appear as scenarios in the file.

Others spot-verified the same way: `csv-upload-connector`'s "size and encoding limits" and
"file-lifecycle cleanup on delete" (three matching requirements); `panel-polling`'s "pausing/resuming
based on browser tab visibility"; `rest-api-connector`'s "redacting credentials from API responses";
`resource-metadata`'s "`createdBy` reflects the authenticated user at resource-creation time";
`smart-panel-placement`'s "without disturbing existing saved panel positions". All directly traceable.

#### Standards / code-quality checklist

- **`CONTRIBUTING.md` [mechanical] compliance** — `scripts/check-spec-structure.mjs` is 230 lines,
  inside the ~250-line soft budget. All imports at top of file; no inline fully-qualified names. No
  secrets. `check:scala-quality` passes (no Scala touched). `DESIGN.md` is not binding — no
  `frontend/**` change.
- **DRY** — reuses openspec's real `extractRequirementsSection`, `MarkdownParser` and `Validator`
  instead of reimplementing their scoping rules. This is the single most important design property
  here: the two scoping behaviors the invariant compares are the tools' *own*, so the guard cannot
  drift from what a real archive does.
- **Readable** — named regexes at module scope, one small pure function per concept
  (`inFileRequirementNames`, `parserVisibleNames`, `validatorVisibleNames`, `setsEqual`,
  `findDuplicates`), and a header comment that explains *why* parser-visibility alone is insufficient.
  No magic values.
- **Modular / separation of concerns** — module resolution, enumeration, and per-check logic are
  cleanly separated; the optional directory argument is the seam that makes the guard self-testable.
- **Type safety** — plain ESM with a `@type {string[]}` annotation on the accumulator; no TS escape
  hatches involved.
- **Security** — no user input, no network, no shell interpolation. `execFileSync("which", ["openspec"])`
  passes an argument array, not a shell string, so there is no injection surface.
- **Error handling at boundaries** — CLI-missing → exit 2 with a message; internal-module import
  failure → exit 2 naming the resolved root; unreadable specs dir → exit 2; unreadable individual
  `spec.md` → skipped. No silent pass paths.
- **No dead code** — no unused imports (`readFileSync`/`readdirSync`/`realpathSync`/`statSync`,
  `join`/`dirname`, `fileURLToPath`/`pathToFileURL`, `execFileSync` all used); no TODO/FIXME.
- **No over-engineering** — one invariant plus three diagnostic checks, exactly as designed; no
  speculative abstraction.
- **Behavior-preserving where expected** — this is a structural repair, and the 1476-block hash
  comparison is the proof that it moved nothing it should not have. No drive-by behavior changes.
- **Wiring** — `.husky/pre-commit` places `npm run check:spec-structure` **before**
  `npm run check:openspec`, as task 7.3 requires (load-bearing under `set -e`, so the known-flaky
  hygiene check cannot gate this one). `package.json` script added.
- **Tests** — no automated unit test for the guard, but neither `check-openspec-hygiene.mjs`,
  `check-schema-drift.mjs` nor `check-scala-quality.mjs` has one either; this matches the repo's
  existing convention for `scripts/*.mjs`, so it is not a regression. The fixture evidence above (which
  I reproduced independently) covers the behavior.

Issues: none blocking.

---

### Phase 3: UI Review — N/A

No UI-affecting file changed. `git diff --name-only main...HEAD` contains no path under `frontend/**`,
no `backend/src/main/scala/routes/ApiRoutes.scala`, and no `schemas/**`. `openspec/specs/**` does match
the nominal trigger list, but this change alters spec *structure* only — zero requirement text changed
(proven above), so there is no described behavior for a UI to diverge from and no runtime surface to
exercise. Per the orchestrator's instruction, dev servers were not started and that budget was spent on
the spec/code phases instead.

---

### Overall: PASS

Every acceptance criterion is met, and the two claims most capable of hiding a defect behind a green
check — "no requirement was lost or altered" and "the guard actually fails" — were each verified
mechanically against a corpus that can discriminate, not by reading the diff or trusting the executor.

### Change Requests

None.

### Non-blocking Suggestions

1. `CONTRIBUTING.md:139-147` — the "Pre-Commit Policy" code block enumerates the Husky chain and now
   lists 6 of the 7 commands `.husky/pre-commit` actually runs. Add
   `npm run check:spec-structure   # Canonical spec structure (openspec/specs/)` between the
   `check:schemas` and `check:openspec` lines so the canonical contributor doc matches the hook it
   documents. (Not covered by any AC or task, and `CLAUDE.md`'s looser summary was already generic, so
   this is the only doc that drifted.)
2. `design.md` decision 3 item 1 and `tasks.md` 7.1 still describe the validity check as "shell out to
   `openspec validate --specs`", which is not the mechanism that shipped. The deviation is documented in
   `scripts/check-spec-structure.mjs:22-30` and I verified it equivalent, but a one-line amendment to
   decision 3 would keep the planning artifacts matching the code for future readers.
3. `scripts/check-spec-structure.mjs:29-30` — the comment points at "check-spec-structure.spec.md's
   test plan"; no such file exists anywhere in the repo. The adjacent "HEL-775 task 7.4" reference is
   valid, so just drop the dangling half.
4. `scripts/check-spec-structure.mjs:171` — `content.match(DELTA_HEADING_RE)` reports only the *first*
   delta-only heading in a file, so a spec carrying both a stray `## ADDED` and a stray `## MODIFIED`
   would surface one of them per run. Diagnostics only — the set-equality invariant still fails such a
   file — but `matchAll` would make the message complete.
5. `scripts/check-spec-structure.mjs:230` — `main()` is invoked without a `.catch()`. Modern Node turns
   an unhandled rejection into a non-zero exit, so the guard still fails red, but an explicit
   `.catch(e => { console.error(e); process.exit(2); })` would make the failure mode intentional rather
   than incidental.
6. `openspec/specs/shared-inline-error/spec.md` — deleting the duplicate `## Requirements` heading line
   leaves a `- **THEN**` bullet directly adjacent to the next `### Requirement:` with no blank line.
   This was already the case before the repair and the omission is what keeps the block hashes
   byte-identical, so it should **not** be "fixed" as part of this change; noting it only so a future
   reader does not mistake it for damage.
