## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed at `d124546b` (11 commits ahead of `origin/main` @ `649f1490`); D6 base
`3596b161`. Backend-only change; **Phase 3 (UI) is N/A** by scope (no `frontend/**`
runtime code, no `ApiRoutes` route-surface change, no `schemas/**`, no
`openspec/specs/**` — see "Scope confirmation" below). No dev servers started.

Every gate below was run fresh by me in `WORKTREE_PATH`; nothing is taken from the
executor's or orchestrator's own reports.

---

### Phase 1: Spec Review — PASS

Acceptance criteria, each traced to evidence I produced myself:

| AC | Verdict | Evidence |
|---|---|---|
| `sbt test` green; test diff limited to `package`/`import` lines | PASS | My own run: 3346 tests / 212 suites, 0 failed, exit 0 — identical to `baseline/tests.txt`. D6 filter over the 179 changed test files: 0 content differences. |
| `git log --follow` still traces moved files | PASS | `--follow` on `domain/model/model.scala` traces 58 commits back through the rename; `services/panels/PanelPacker.scala` traces 3. Independently, `git diff -M origin/main...HEAD` (the squash-equivalent view) detects **248 renames**, which is **exactly** the set of 248 `old_path != new_path` rows in `mapping.tsv` — byte-identical when diffed. No unmapped move exists and no mapped move failed rename detection. |
| `rg 'com\.helio\.security'` returns nothing; `security/` deleted | PASS (code) | Zero hits repo-wide. `backend/src/main/scala/com/helio/security/` is gone (its only tracked file, `README.md`, deleted). See CR-2 for the one *slash-form* reference left behind. |
| No file directly in `services/`, `api/routes/`, `api/protocols/`, `infrastructure/` except the named shared files | PASS | `services/` → `ServiceError.scala` only; `api/routes/` → `ServiceResponse.scala` only; `api/protocols/` → `IdParsing`/`PaginationProtocol`/`ResourceProtocol` only; `infrastructure/` → **no** `.scala` at all; `infrastructure/persistence/` → `Database.scala` + `DbContext.scala` (D3); `api/` root → `ApiRoutes`/`JsonProtocols`/`package.scala`; `domain/` root → `package.scala` (D5). |
| A `README.md` in each newly created directory, what belongs AND what does not, verified against actual contents | PASS with defects | 60 newly created directories, **60 READMEs, 0 missing**. Automated cross-check: every README names **every** `.scala` file in its own directory (0 exceptions); every backticked CamelCase name resolves to a real file/type (the only non-resolving ones are third-party: `RootJsonFormat`, `Directives`, `ExecutionContext`). Two READMEs are nevertheless factually wrong — CR-2, CR-3. |
| No inline FQNs introduced | PASS | `npm run check:scala-quality` clean (it carries `com.helio.` in `FQN_PREFIXES`). |
| Route surface and mount order unchanged; implicit resolution unchanged | PASS | Proven two ways, see Phase 2 "Structural verification". |

Other Phase-1 checks: no scope creep (only out-of-`backend/` file is
`scripts/check-schema-drift.mjs`, reviewed below); no API/schema/migration surface
touched; planning artifacts match the delivered tree (the one unchecked task —
post-squash `git log --follow` — is legitimately deferred to Delivery and I verified
it already holds on the squash-equivalent diff).

**Scope confirmation for Phase 3 = N/A**: `git diff --name-only origin/main...HEAD`
returns only `backend/**`, `openspec/changes/repackage-backend-domain-subpackages/**`
and `scripts/check-schema-drift.mjs`. `backend/src/main/scala/com/helio/api/ApiRoutes.scala`
is modified but its content is byte-identical modulo `package`/`import` lines (D6),
so the `~` mount chain is provably unchanged.

---

### Phase 2: Code Review — FAIL

#### Verification gates (all run by me, fresh)

| Gate | Result |
|---|---|
| `npm run check:repo-integrity` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run check:schemas` | exit 0 |
| `npm run check:spec-structure` | exit 0 |
| `npm run check:openspec` | exit 0 |
| `npm run check:openspec:selftest` | exit 0 |
| `npm run check:scala-quality` | exit 0 — clean, **131** soft warnings |
| `npm test` (jest + frontend) | exit 0 |
| `cd backend && sbt test` | exit 0 — **3346 tests / 212 suites**, 0 failed |

Quality warned-**set** diff vs `baseline/quality.txt`, re-derived independently:
**+6 / −3**, and the members are exactly the 6 additions and 3 removals
`baseline/quality-deltas.md` names in advance. This is the D6 pre-authorised
exception and is correctly *documented*, not engineered away.

D7(c) uniform single-line emission rule verified positively:
`grep -rlE '^import com\.helio\.[a-zA-Z.]+\.?\{[^}]*$' backend/src` returns exactly 2
files (`domain/shapes/{SingleRowShape,TimeSeriesShape}.scala`), and neither is touched
by this change (`git diff` empty for both) — i.e. the rule holds with zero exceptions.

#### Structural verification (what I re-derived, plus what it missed)

Re-derived independently, all confirming the executor's claims:

- **D6 primary gate**: 540 base `.scala` vs 540 worktree `.scala`, iterated over the
  union; **540 compared, exactly 1 content difference (`api/package.scala`), 0 missing
  targets, 0 orphans.**
- **Allow-listed file**: `sed -E 's/protocols\.[a-z]+\./protocols./g'` on the new
  `api/package.scala` is **byte-identical** to base.
- **Package/directory agreement**: 540/540, 0 mismatches; every file has exactly one
  single-clause `package` declaration (D0.2 respected — zero nested package clauses).
- **HEL-634 boundary**: `git diff --name-status backend/src/test/` → 179 paths, **all
  `M`**, zero `A`/`D`/`R`.

**D6 is blind to `import` lines by construction, so I attacked that blind spot
directly.** Results (all clean):

1. **Import-statement differential over all 540 file pairs.** Non-`com.helio` imports
   are set-identical in 539/540 files; the single exception is
   `PanelServiceScatterAggregationSpec.scala`, where a *relative* import
   (`import PanelServiceHelpers.validateScatterAggregationConflict`) was correctly
   rewritten to its absolute form — an import rewrite, not an inlined FQN. **Zero
   alias (`{X => Y}`) changes anywhere** — all 13 `ResourceType => AclResourceType`
   aliases survive verbatim. **Zero named `com.helio` imports lost.** All 8
   object-wildcard imports (`X._` on a moved object) point at the correctly mapped
   new FQN.
2. **Same-name shadowing.** Across the whole backend there is exactly **one**
   duplicated top-level simple name — `ResourceType` (`api.http` case class vs
   `domain.model` sealed trait), which was equally duplicated in base
   (`api` vs `domain`). I traced all 25 files referencing it: each resolves to the same
   symbol as in base (aliases preserved; `ApiRoutes` still constructs the `api.http`
   case class; `PermissionService` still gets the `domain.model` trait).
3. **Implicit re-resolution.** Verified on the *final* tree, not assumed: no top-level
   package object declares an `implicit` (`api/package.scala` 0, `domain/package.scala`
   0); the only two live in `domain/panels/package.scala`, which does not move and is
   reached by explicit wildcard. `JsonProtocols`' mixin chain is **39 direct mixins**
   (1 `extends` + 38 `with`) and its body is byte-identical to base, so the
   inheritance-scoped premise still holds.
4. **Bytecode-level proof (the decisive one).** I compiled the base tree
   (`3596b161`) in a throwaway sbt project and compared **constant pools** class-by-class
   against the worktree build, mapping `com/helio/...` names through `mapping.tsv`:
   - `classes`: 2059 base ↔ 2059 worktree — 0 missing, 0 extra.
   - `test-classes`: 352 ↔ 352 — 0 missing, 0 extra.
   - **Referenced `com.helio` type set: 0 differing classes out of 2411.**
   - Full printable-constant set (method names + descriptors + string literals):
     **identical for all 352 test classes**, and for 2043/2059 main classes. The 16
     exceptions are Slick-generated `"Fast Path of (…).mapTo[…]"` debug strings that
     differ *only* by the package rename.

   This closes the blind spot completely: if any import had re-resolved a reference —
   to a different class, a different implicit, or a different overload — the referenced
   method/class names in the constant pool would differ. They do not. **"No behaviour
   changed" is now proven at the symbol-resolution level, not just at source level.**
5. **Things D6 cannot see at all.** `com.helio` string literals in backend sources:
   exactly the two D9/HEL-803 logger names
   (`services/proposals/AuthoringTelemetry.scala:33`,
   `services/assistant/AssistantTelemetry.scala:29`) plus their matching test
   assertions — all left stale **on purpose and correctly**, and there is no third
   case. No reflection (`Class.forName`/`getResource`/`ServiceLoader`) names a moved
   package. Zero `com.helio` in `backend/src/{main,test}/resources/`, `.github/`, or
   any `META-INF/services`. `build.sbt`'s `assembly / mainClass := "com.helio.app.Main"`
   is unaffected (`app/` did not move).
6. **`scripts/check-schema-drift.mjs`** (outside D6's proof) — reviewed on its own
   merits: three path constants repointed plus `readdirSync(protocolsDir, { recursive:
   true })`. Verified non-vacuously: the recursive read finds **46/46** protocol
   `.scala` files (a flat read would have found 3), README files are excluded by the
   existing `.endsWith(".scala")` filter, and `recursive` is supported by the Node 22
   used both locally and in `.github/workflows/ci.yml`. `npm run check:schemas` passes.
   No logic change. **Accepted.**

#### Findings — the reason this phase fails

**CR-1 is the substantive one.** It is dead code introduced by this change, at scale,
that no gate in the plan can see: D6 masks import lines by construction, the compiler
does not warn (no `-Wunused` in `backend/build.sbt`), and `check-scala-quality.mjs`
only looks for *inline* FQNs. I found it by compiling both trees with
`-Wunused:imports` and diffing.

- Base tree: **12** unused `com.helio` imports.
- This tree: **175**.
- **142 unused `com.helio` import statements, across 104 files, are new** — i.e. this
  change turned 142 previously-live imports into dead ones.

CR-2 and CR-3 are small but land squarely on this change's own thesis: the proposal's
stated motivation is that `com/helio/security/` was "an empty package whose README
describes code that lives elsewhere", and `tasks.md` requires updating any README the
moves make wrong.

---

### Phase 3: UI Review — N/A

Backend-only structural change. No `frontend/**` runtime code, no route-surface or
mount-order change (proven by D6 over `ApiRoutes.scala`), no `schemas/**`, no
`openspec/specs/**`. Per the orchestrator's scope note, no dev servers were started and
no Playwright run was performed; that effort went into the structural verification above.

---

### Overall: FAIL

To be explicit about proportion: the *code* is verified clean to an unusually high
standard — D6, package/directory agreement, the HEL-634 boundary, the quality-set
arithmetic, and a full bytecode symbol-reference comparison all pass, and the last of
those independently proves the iron constraint held. The three change requests below
are all **import-line and Markdown edits**, every one of which is inside the iron
constraint's permitted set ("moves, `package` declarations, imports, and READMEs
only"), and none touches `openspec/specs/`.

---

### Change Requests

**CR-1 — Remove the 142 unused `com.helio` imports this change introduced (104 files).**

Reproduce the exact list (no file edits required to run it):

```bash
cd backend && sbt -batch 'set ThisBuild/scalacOptions += "-Wunused:imports"' clean Test/compile 2>&1 \
  | grep -A1 'Unused import' | grep 'import com\.helio'
```

Breakdown of the new (not pre-existing) ones:

| count | statement | why it is now dead |
|---|---|---|
| 89 | `import com.helio.domain._` | left in place beside the newly added `import com.helio.domain.model._`; `com.helio.domain` now only carries the 51 `steps` aliases, which these files do not use |
| 26 | `import com.helio.api.http._` | added to every `api/routes/<domain>/` file in Layer 6, including 26 that reference none of `api/http`'s 10 names |
| 10 | `import com.helio.infrastructure._` | superseded by the added `infrastructure.persistence.<domain>` imports |
| 6 | `import com.helio.services._` | superseded by the added `services.<domain>` imports |
| 4 | `import com.helio.api.protocols._` | superseded by the added `api.protocols.<domain>` imports |
| 2 | `import com.helio.domain.model._` | added where nothing from `domain.model` is referenced |
| 5 | individually named (e.g. `RequestValidation.scala:4` `api.protocols.assistant.ConverseRequest`) | see the command's output |

Concrete examples: `backend/src/main/scala/com/helio/api/protocols/IdParsing.scala:5`,
`backend/src/main/scala/com/helio/api/routes/alerts/AlertEventRoutes.scala:9` (`api.http._`)
and `:11` (`domain._`), `backend/src/main/scala/com/helio/api/routes/workspace/HealthRoutes.scala:6`.

Why this is in scope and not scope creep:
- It is dead code *created by this change* — in base, all 89 `import com.helio.domain._`
  statements were live.
- It is exactly the kind of edit the iron constraint permits (import lines only), and
  it is provably behaviour-preserving: an import the compiler reports unused resolves
  nothing, so deleting it cannot change resolution.
- It works against the ticket's own purpose. A reader opening
  `api/protocols/alerts/AlertEventProtocol.scala` and seeing `import com.helio.domain._`
  will conclude it depends on the step vocabulary. It does not. The epic exists to stop
  the layout lying about dependencies.

After the sweep, re-run and record: the D6 gate (must stay at exactly 1 allow-listed
difference — import lines are masked, so it will), `sbt test` (3346/212), and the
quality warned **set**. Note that deleting import lines can move a file back under the
250-line soft budget; if the +6/−3 set changes, update
`baseline/quality-deltas.md` with the new arithmetic rather than reflowing anything.

Acceptance for CR-1: the `-Wunused:imports` `com.helio` count returns to the base
tree's **12** (or, if any of the remaining 12 is now genuinely reachable, to a number
you state and justify).

**CR-2 — `backend/README.md:12` still lists a package this change deleted.**

```
- `src/main/scala/com/helio/security` authn/authz and validation boundaries
```

`com/helio/security/` no longer exists (Layer 7, commit `9ee72304`). The `rg
'com\.helio\.security'` AC passes only because this reference is in slash form. Remove
the line (and, while you are in the layer list on lines 9–14, it is now materially
incomplete — `api`/`domain`/`infrastructure` all gained the subdirectory structure this
ticket created; a one-line pointer to the per-directory READMEs would make the list
true rather than merely less false). Markdown only.

**CR-3 — `backend/src/main/scala/com/helio/infrastructure/README.md:5` misdescribes
`crypto/`.**

It states `crypto/` holds "(hashing/TOTP primitives)". `infrastructure/crypto/` contains
`TokenHashing.scala` only; the TOTP primitives are in
`infrastructure/persistence/auth/TotpSupport.scala` — as `infrastructure/crypto/README.md`
itself correctly and explicitly documents. Change to "(hashing primitives)" so the two
READMEs agree, or say what `crypto/README.md` says. One word.

(For the record, I checked `TotpSupport`'s placement itself: it performs no DB access
and is pure crypto, so `persistence/auth/` is arguably the wrong home — but
`crypto/README.md` names the anomaly, gives the reason (HEL-633's layout enumerates
`crypto/` as `TokenHashing` only), and does not pretend otherwise. That is a documented
judgment call, not a defect, and I am deliberately leaving the placement question to
the skeptic rather than requesting a move.)

---

### Non-blocking Suggestions

- **Documentation drift outside `openspec/specs/` is unrecorded.** D11/HEL-804 surveyed
  only `openspec/specs/`. These four in-repo pointers are now stale and are *not*
  covered by that spinoff:
  `docs/compute-expression-grammar.md:3` (`com/helio/domain/ExpressionEvaluator.scala`
  → `domain/engine/`), `notes/uploads-filesystem-layout.md:4`
  (`com/helio/infrastructure/FileSystem.scala` → `infrastructure/storage/`),
  `frontend/src/features/pipelines/types/pipelineShape.ts:3`
  (`api/protocols/PipelineShapeProtocol.scala` → `api/protocols/pipelines/`),
  `frontend/src/features/dashboards/types/{authoring.ts:4,refinement.ts:12,21}`
  (`com.helio.services.AuthoringErrorKind` → `services.proposals`;
  `com.helio.api.protocols.Refinement*` → `api.protocols.patchsets`). Cleanest
  resolution is to **widen HEL-804** to "all in-repo references to moved
  `com.helio` paths/packages" and add a line to design.md D11 saying so — editing
  `frontend/**` here really would be scope creep. (`CONTRIBUTING.md:29`'s
  `com.helio.domain.PanelId(...)` is an illustrative anti-pattern example; harmless
  either way.)
- `api/routes/workspace/README.md:8-9` says "every route class is a thin Pekko HTTP
  `Directives` shell that delegates to a `services/workspace/` service" — true of
  `WorkspaceRoutes`, not of `HealthRoutes`, which completes `HealthResponse` inline with
  no service. The paragraph above it already explains `HealthRoutes` honestly; the
  boilerplate below just needs "(`HealthRoutes` has no service)".
- `services/layout/` survives in this worktree as an **empty, untracked** directory
  (leftover from `git mv`). `git ls-files services/layout/` is empty, so it does not
  exist in the commit and cannot reach `main` — noted only so nobody mistakes it for a
  14th `services/` subdirectory during review.
- The four `TokenHashing`-style scaladoc headers that name their old package (e.g.
  `infrastructure/crypto/TokenHashing.scala:9` "Lives in `com.helio.infrastructure`")
  are covered by D9's stated policy ("prose goes stale rather than the diff going
  impure") and are correctly left alone. Worth folding into the widened HEL-804.

---

### Note for the skeptic

Two placement calls are documented-but-debatable and I have deliberately not ruled on
them, since both are judgment rather than mechanics:
`HealthRoutes` in `api/routes/workspace/` (vs `api/routes/` root beside
`ServiceResponse`), and `TotpSupport` in `infrastructure/persistence/auth/` (vs
`infrastructure/crypto/`). Both are named and reasoned in their own READMEs.
