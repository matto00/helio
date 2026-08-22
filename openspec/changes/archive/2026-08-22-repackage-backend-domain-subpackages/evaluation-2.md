## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed at `7d90892e` (executor fixes at `d54cf536`, orchestrator doc-only commit on top).
D6 base `3596b161`. Backend-only change; **Phase 3 (UI) remains N/A** — the cycle-2 diff
touches no `frontend/**` runtime code, no route surface, no schema.

Every number below was re-derived by me from a fresh run. Nothing is accepted from the
executor's or orchestrator's reports.

---

### Phase 1: Spec Review — PASS

All acceptance criteria still hold; re-verified rather than carried over from cycle 1:

- `sbt test` **3346 tests / 212 suites, 0 failed** — identical to `baseline/tests.txt`.
- Test tree: **179 paths, all `M`**, zero `A`/`D`/`R` (HEL-634 boundary intact).
- `git diff -M origin/main...HEAD` detects **248 renames**, byte-identical to the 248
  `old_path != new_path` rows of `mapping.tsv`.
- `rg 'com\.helio\.security'` **and** `com/helio/security` now both return nothing
  repo-wide (CR-2 closed the slash-form gap).
- Directory-contents ACs: `services/` holds only `ServiceError.scala`; `api/routes/` only
  `ServiceResponse.scala`; `api/protocols/` only the three root files; `infrastructure/`
  no `.scala` at all; `persistence/` root only `Database`/`DbContext`; `api/` root the
  three stay-put files; `domain/` root only `package.scala`.
- **60 newly created directories, 60 READMEs, 0 missing.**
- No inline FQNs (`check:scala-quality` clean).

---

### Phase 2: Code Review — PASS

#### The cycle-2 diff is provably import-only

`git diff -U0 d124546b..HEAD -- '*.scala'` — **every single changed line is an `import`
line.** Zero non-import lines added or removed across all 150 changed `.scala` files
(224 deletions, 6 additions; all 6 additions are a braced import re-emitted with one
selector dropped). Non-`.scala` changes are `backend/README.md`,
`infrastructure/README.md`, and three files under the change directory.

#### Gates (all run fresh by me)

| Gate | Result |
|---|---|
| `check:repo-integrity`, `lint`, `typecheck`, `format:check` | exit 0 |
| `check:schemas`, `check:spec-structure`, `check:openspec`, `check:openspec:selftest` | exit 0 |
| `check:scala-quality` | exit 0 — clean, **129** soft warnings |
| `npm test` | exit 0 |
| `cd backend && sbt test` | exit 0 — **3346 / 212** |

Warned-**set** re-derived independently: **128 + 4 − 3 = 129**, members exactly as
`baseline/quality-deltas.md` states. `MetricRepository.scala` and
`PanelServiceCompanionBindingGuardSpec.scala` are both now at **249** lines — they fell
out of the warned set as a byproduct of dead-import removal, as documented.

#### Structural gates re-derived

- **D6**: 540 base vs 540 worktree, iterated over the union — **540 compared, exactly 1
  content difference (`api/package.scala`), 0 missing, 0 orphans.**
- `api/package.scala` `sed` round-trip vs base: **byte-identical**.
- **Package/directory agreement**: 540/540, 0 mismatches; every file has exactly one
  single-clause `package` declaration (no nested clauses — D0.2 intact).
- **D7(c)**: only `domain/shapes/{SingleRowShape,TimeSeriesShape}.scala` retain a
  multi-line braced `com.helio` import, and both are untouched by this change.

#### CR-1 — VERIFIED RESOLVED, by a stricter method than was used to raise it

Re-ran `-Wunused:imports` on **both** trees with **`-Xmaxwarns 10000`**, and classified
each warning by its **enclosing import statement** rather than by the line the caret sits
on (this matters: a multi-line braced import's selector warning prints only the bare
selector, e.g. `  PipelineStepResponse,`, on the following line).

| | base `3596b161` | worktree `7d90892e` |
|---|---|---|
| unused imports, all libraries | 49 | 42 |
| of which `com.helio` | **16** | **9** |
| of which non-`com.helio` | 33 | 33 |

- **NEW unused `com.helio` imports introduced by this change and still present: 0.**
  CR-1 is fully discharged.
- Non-`com.helio` unused count is **unchanged at 33** in both trees — the sweep touched
  no third-party import.
- The 9 that remain are each present, unchanged, in the base tree (3 × `domain.panels._`
  in `DashboardRepository`/`PanelRepository`/`PanelService`; `Database` in
  `ApiRoutesSpec` and `DataSourceRoutesSpec`; a scope-local `domain._` in
  `ApiRoutesSpec`; `api.routes._` and `RestApiConfig` in `ComputedFieldsRoutesSpec`;
  `PanelService` in `DataTypeDataSourceAclSpec`).

#### Orchestrator decision 1 — "accept 9 rather than 12": SAFE, but the numbers behind it are wrong

You asked me to check whether each pre-existing entry the executor removed is genuinely
dead **in the base tree**. Answer: **yes, every one of them** — each appears verbatim in
the base tree's own uncapped `-Wunused:imports` output. No behaviour change; the decision
stands on its stated reasoning.

But the arithmetic it was framed with does not survive re-derivation, and the same
artifact that produced my own cycle-1 undercount produced this one:

- Base's pre-existing unused `com.helio` count is **16, not 12**.
- The number of pre-existing dead entries this change removed is **7, not 3**.

The four the executor's list omits, each confirmed dead in base with its base
`file:line:col`:

| file (new path) | selector | base warning |
|---|---|---|
| `services/patchsets/PatchSetApplyRollback.scala` | `PipelineStepResponse` | `services/PatchSetApplyRollback.scala:18:3` |
| `test/api/ApiRoutesSpec.scala` | `RestApiConfig` | `ApiRoutesSpec.scala:23:3` |
| `test/api/ComputedFieldsRoutesSpec.scala` | `SlickUserSessionRepository` | `ComputedFieldsRoutesSpec.scala:23:3` |
| `test/api/PipelineStepRoutesSpec.scala` | `FilterStepResponse` | `PipelineStepRoutesSpec.scala:12:3` |

All four sat on continuation lines of **multi-line braced** imports in base, so any
classifier keying on the printed line rather than the enclosing statement misses them —
which is exactly why both the executor's "12 / 3" and my own cycle-1 "base 12 / 142 new"
were undercounts. Arithmetic check that the corrected figures close: 16 − 9 = 7 removed,
and total-unused 49 − 42 = 7, with non-helio flat at 33. Consistent.

**This does not change the decision.** The rationale — trivial, compiler-verified dead in
both trees, disclosed unprompted — applies identically to all 7. And the invariant
`quality-deltas.md` correctly identifies as load-bearing ("every import removed in this
sweep is compiler-verified dead") is one I independently confirmed. Only the counts are
wrong, and only in a direction that does not weaken the argument. Recorded as a
non-blocking correction (NB-1) rather than a change request.

`RestApiConfig` deserves a sentence because it looks alarming and is not: `ApiRoutesSpec`
still calls `RestApiConfig(...)` at `:1876`/`:1922` with no top-level import for it. Those
call sites sit inside blocks carrying their own scope-local `import com.helio.domain.model._`
(15 such blocks), which shadows the file-level binding — which is precisely why the
compiler flagged the file-level selector as unused **in base too**.

#### Orchestrator decision 2 — the `-Xmaxwarns` cap: CONFIRMED, and correctly demoted to an explanation

Independently corroborated: the base tree emits **49** warnings under `-Xmaxwarns 10000`,
identical to its uncapped-by-luck earlier run (23 in the `Compile` phase, 34 in `Test` —
neither approaches 100), so base was never truncated, while the worktree's first pass was.
`quality-deltas.md` is right that soundness rests on **convergence to a fixed point**, not
on the cap hypothesis. I did not rely on either: I re-ran both trees with the cap lifted
and got 0 new unused imports directly.

#### The decisive check, re-run on this tree

Bytecode constant-pool comparison, base build vs worktree build, class-by-class through
the rename map:

- `classes`: **2059 ↔ 2059** — 0 missing, 0 extra.
- `test-classes`: **352 ↔ 352** — 0 missing, 0 extra.
- **Referenced `com.helio` type set: 0 differing classes out of 2411.**
- Full printable constant set (method names + descriptors + string literals): identical
  for all 352 test classes and 2043/2059 main classes; the 16 exceptions are the same
  Slick `"Fast Path of (…).mapTo[…]"` debug strings, differing only by package rename.

Since removing an import can only matter if it changes what a reference resolves to, and
no class in either tree references a different symbol, **all 224 import removals are
proven behaviour-neutral** — including the 7 pre-existing ones. This is the check that
answers decision 1 conclusively, independent of any warning count.

#### Things D6 cannot see — re-checked on this tree

- `com.helio` string literals: still exactly the two D9/HEL-803 logger names
  (`services/proposals/AuthoringTelemetry.scala:33`,
  `services/assistant/AssistantTelemetry.scala:29`), correctly left stale. No third case.
- Zero `com.helio` in `backend/src/{main,test}/resources/`, `.github/`, or any
  `META-INF/services`.
- No reflection or resource path names a moved package.

#### CR-2 / CR-3 — both closed

- **CR-2** (`backend/README.md`): fixed, and more thoroughly than requested — the stale
  `security` line is gone and the layer list now describes the subdirectory structure this
  ticket created, with pointers to the per-directory READMEs. `services/` (previously
  absent entirely) is now listed.
- **CR-3** (`infrastructure/README.md:5`): `crypto/` now reads "hashing primitives",
  agreeing with `infrastructure/crypto/README.md`.

#### README re-verification — I checked the "all ~50 re-verified" claim independently

Two mechanical checks across all **67** READMEs under `com/helio`:

1. **`Holds:` set equality.** For every README carrying a `Holds:` line (52 of them), the
   set of names it claims is **exactly equal** to the set of `.scala` basenames actually in
   that directory — **0 mismatches, in either direction**, and **0** entries naming a file
   that actually lives somewhere else. The other 15 are structural/root READMEs that
   describe subdirectories in prose; each still names every `.scala` in its own directory.
2. **Every backticked directory reference resolves to a real directory** — with one
   exception, NB-2 below.

The claim holds. One defect found, and it is not about any directory's own contents.

---

### Phase 3: UI Review — N/A

Backend-only. No `frontend/**` runtime code, no route-surface or mount-order change
(`ApiRoutes.scala` remains content-identical to base modulo `package`/`import`), no
`schemas/**`, no `openspec/specs/**`. No dev servers started, no Playwright run.

---

### Overall: PASS

All three cycle-1 change requests are discharged, verified by re-derivation rather than
report. The iron constraint is proven intact at the symbol-resolution level across 2411
compiled classes, and the cycle-2 diff is provably import-only. The items below are
non-blocking; none of them is a code defect.

---

### Change Requests

None.

---

### Non-blocking Suggestions

**NB-1 — Correct two counts in `baseline/quality-deltas.md` (and the matching line in
`workflow-state.md`) before archive.** The document states the base tree had **12**
pre-existing unused `com.helio` imports and that **3** were removed; re-derivation with
`-Xmaxwarns 10000` and statement-level classification gives **16** and **7**. The four
missing from the list are named in the table above. The document's conclusions are all
correct and independently confirmed — only these two numbers are wrong. Worth fixing
precisely because this artifact is the change's evidence record, and because the same
misclassification is what caused three compiler passes to be needed; naming it will save
the next person the same trap. Consider adding it to **HEL-807**'s scope note: a
`-Wunused` sweep on this backend must be classified by enclosing import statement, not by
the printed warning line.

**NB-2 — `backend/src/main/scala/com/helio/services/hooks/README.md:8` points at a
directory that does not exist.** It reads "Does NOT hold: … or persistence
(`infrastructure/persistence/hooks/`)". There is no `infrastructure/persistence/hooks/` —
`hooks` is the one domain with no persistence subpackage (its layer census is
routes 1 / protocols 1 / services 1 / persistence **0**), because `HookTriggerService`
uses other domains' repositories. This is the only dead directory reference among all 67
READMEs, and it is templated boilerplate about where such code *would* live rather than a
claim about this directory's contents (`Holds: HookTriggerService` is exactly right), so
it does not breach the AC. Cheapest fix: drop the parenthetical, or write
"(`infrastructure/persistence/<domain>/` — `hooks` has none; `HookTriggerService` uses
other domains' repositories)".

**NB-3 — Worktree hygiene: a straggler git worktree is still registered.**
`git worktree list` shows
`/tmp/claude-1000/-home-matt-Development-helio/81dca7ce-a9ca-4c3a-8451-070630f82b8d/scratchpad/hel633/base_worktree`
detached at `3596b161` — the executor's throwaway base checkout for its own
`-Wunused` comparison. Harmless functionally, but it lives in the repo's
`.git/worktrees/` admin metadata and is exactly what the Delivery-phase hygiene check
looks for. Clear it with `git worktree remove --force <path>` (or
`rm -rf <path> && git worktree prune`) before Delivery. For the record, my own base tree
was extracted with `git archive` into a scratch directory, so it registers no worktree and
leaves nothing to clean.

**NB-4 — Documentation drift outside `openspec/specs/` is still unrecorded** (carried
forward from cycle 1, unchanged and still non-blocking): `docs/compute-expression-grammar.md:3`,
`notes/uploads-filesystem-layout.md:4`,
`frontend/src/features/pipelines/types/pipelineShape.ts:3`, and
`frontend/src/features/dashboards/types/{authoring.ts:4,refinement.ts:12,21}` all name
`com.helio` paths/packages this change moved. D11/HEL-804 surveyed only `openspec/specs/`.
Cleanest resolution remains widening **HEL-804** to "all in-repo references to moved
`com.helio` paths/packages" plus a line in design.md D11 — editing `frontend/**` here
would be scope creep.

**NB-5 — `backend/README.md` still opens "Backend Scaffold … No service implementation is
included yet."** Pre-existing and well outside this ticket; noted only because CR-2 made
the rest of that file accurate, which leaves the header as the one remaining false
statement in it.

---

### Note for the skeptic

Unchanged from cycle 1: two placement calls are documented-but-debatable and I have
deliberately not ruled on them, since both are judgment rather than mechanics —
`HealthRoutes` in `api/routes/workspace/` (vs `api/routes/` root beside `ServiceResponse`),
and `TotpSupport` in `infrastructure/persistence/auth/` (vs `infrastructure/crypto/`).
Both are named and reasoned in their own READMEs. NB-2 above is adjacent to the second of
these and is worth a glance in the same pass.
