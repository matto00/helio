# Design — Repackage backend main into domain subpackages

## Context

Measured at `29fc0528`: `services/` 88, `api/routes/` 48, `api/protocols/` 46, `infrastructure/` 40,
`domain/` root 22 = **244 movers**; plus `api/` root 12 and `services/layout/` 1 = **257 to map** (D8).
Test tree 218 files. HEL-632 fixed eight domain names and HEL-633 lists per-file placements; both were
written 2026-07-27 against a 215-file tree that is now 322, and are stale as enumerated below.

**The thirteen domain names, written down once, here** (HEL-633 names the first eight only in Linear;
D1 adds the last five): `alerts`, `auth`, `dashboards`, `panels`, `pipelines`, `sources`, `workspace`,
`hooks`, `metrics`, `assistant`, `agents`, `proposals`, `patchsets`. A layer omits a domain only when it
genuinely has no file for it. Spelling them identically in every layer is the whole point (D1).

## D0 — Governing fact: a single-clause package clause does NOT open the enclosing package

This drives D3, D5, D7 and the test surface, and an earlier draft got it wrong in one place while
getting it right in another. Compile-verified with the project's own compiler (Scala 2.13.15):

| Form | Reference to enclosing-package member, no import | Result |
|---|---|---|
| `package com.helio.api.routes.dashboards` (single clause) | `ServiceResponse.hello` | **`error: not found: value ServiceResponse`** |
| `package com.helio.api.routes` ⏎ `package dashboards` (nested) | same | compiles |
| single clause **+ explicit import** | same | compiles |
| single clause + import, member is `private[routes]` | `ServiceResponse.statusCodeFor(200)` | compiles |

**All 540 `.scala` files under `backend/src` use the single-clause form; zero use nesting.** Two
consequences:

1. Every reference from a moved file to a name left behind in its old (now-enclosing) package needs a
   **new import** — including names in the deliberately stay-put shared files. This is why D7(b) is the
   largest category of work in the change.
2. **Converting a file to the two-clause nested form to avoid those imports is forbidden.** It would
   silently widen name resolution for the whole file, which is precisely the kind of behaviour-adjacent
   change the iron constraint exists to exclude. Moved files keep the single-clause `package <new FQN>`
   form taken verbatim from the mapping.

Note the last row: qualified-private access (`private[routes]`) *is* available from a subpackage. Access
and scope are different questions, and only scope is affected by the move.

## Goals / Non-Goals

**Goals.** Subdivide the five flat layers by domain; delete empty `security/`; a verified README per new
directory; `sbt test` green; **provably** identical behaviour (D6).

**Non-Goals.** Behaviour change. Test-file relocation (HEL-634). File splitting. Touching `ai/`, `email/`,
`spark/`, `app/` (HEL-802). Any spec/requirement change.

## Decisions

### D1 — Thirteen domains, not eight (amends HEL-632)

The eight were fixed when eight covered the code. HEL-341/342/343/418/420/659 since shipped **70** files
matching none. Mutually-exclusive classification over the 222 files in the four flat layers, summing to
70: PatchSet 21, Authoring 12, Assistant 12, Refinement 8, Agent{Memory,Preferences} 8, Metric 4,
CombinedProposal 3, ChatAccess 2. Added: `metrics`, `assistant`, `agents`, `proposals`, `patchsets`.

*Absorb into `workspace`* honours "eight fixed" by building a 70-file junk drawer, reproducing the defect
the epic removes. *Distribute by target-of-work* shatters the 21-file PatchSet subsystem across four
packages, so no grep surfaces it. Both rejected.

### D2 — `proposals` and `patchsets` are separate domains

Generating a *new* artifact and applying a validated edit to an *existing* one are distinct subsystems;
combined they are ~51 files, larger than any domain this epic creates, re-creating the flat bag one level
down. `patchsets` takes all 21 `PatchSet*` plus `Refinement*` — `RefinementService`'s header states it
"produces a `PatchSet`, not a `DashboardProposal`". `patchsets` importing the shared
`AuthoringConversation*` substrate from `proposals` is ordinary reuse.

### D3 — Placements this design decides explicitly (several override HEL-633)

- **`DashboardProposalService` → `proposals`**, overriding HEL-633's `dashboards` line. `grep -rl` → **24
  files**, overwhelmingly authoring / patch-set / assistant / proposal; the dashboards-local ones are
  `DashboardContentsService`, `infrastructure/DashboardContentsOps` and dashboards-side routes. (An
  earlier draft also named `DashboardServiceValidation`; wrong — it holds no `DashboardProposal`
  reference. The decision stands on the other 23.) `ProposalPanelSupport` follows it.
- **`ChatAccess*` → `auth`.** Tier/entitlement enforcement, sitting with `UserTierConfig`/
  `BetaAccessService`/`PermissionService`, per HEL-633's own precedent sending `PipelinePermissionService`
  to `auth`.
- **`ServiceResponse.scala` STAYS at `api/routes/` root**, overriding HEL-633's `api/http/` line — on one
  ground only: moving it would force the change's **only** access-qualifier edit. `private[routes]
  statusCodeFor` (`ServiceResponse.scala:76`) is called from `RefinementRoutes:46,48`,
  `DashboardAuthoringRoutes:59,61` and `AssistantConversationRoutes:253` — **three** callers. Under
  `api/http/` those callers lose access and the qualifier must widen to `private[api]`; keeping the file
  under `api/routes/` keeps `routes` enclosing, so `private[routes]` still compiles (D0, row 4). *An
  earlier draft also claimed this avoided 41 new imports. That was false* — per D0 the **40** other
  `api/routes/` files that reference `ServiceResponse` (0 of which import it) need a new import either
  way. They are counted in D7(b) and are not a reason for this placement.
- **`Database.scala` / `DbContext.scala` → `infrastructure/persistence/` root** (beside the domain
  subdirectories). HEL-633's layout says `persistence/{…}/ + Database, DbContext`; an earlier
  `ticket.md` criterion instead permitted them directly in `infrastructure/`. HEL-633's layout wins.
  `DbContext` is referenced in **31 main files (120 including tests)**, so this is not cosmetic.
- **`api/TopLevelErrorHandlers.scala` → `api/http/`** (HEL-633 assigns it nowhere) and
  **`services/layout/PanelPacker.scala` → `services/panels/`**.
- **The `DataType*` family → `pipelines`** (`DataTypeService`, `DataTypeRoutes`, `DataTypeProtocol`,
  `DataTypeRepository`, `DataTypeRowRepository`). HEL-633 assigns it nowhere and it matches none of the 13
  names on its own. A data type is a *pipeline's output artifact* in the settled source → pipeline → type
  → panel chain; `sources` covers ingestion, which is upstream. Named here so it is not a coin-flip
  mid-execution.

### D4 — Scope boundary with HEL-634, and the real test surface

**This ticket edits test `import`/`package` lines only; it moves, renames, merges and splits zero test
files.** Mechanically: `git diff --name-status backend/src/test/` shows only `M` — any `A`/`D`/`R` fails
the change even with `sbt test` green. D6's content filter additionally catches an in-place test *body*
edit, which `--name-status` cannot see.

**The test surface is defined by what fails to compile, not by "carries a `com.helio` import".** 143 test
files match `^import com\.helio\.…`. Separately, **74** test files carry no `com.helio` import at all, and
**35** of those reference a moving name through same-package scope, so they break under D0: `domain/` 16,
`services/` 6, `infrastructure/` 5, `api/protocols/` 4, `api/routes/` 1, `api/` 3. An earlier draft said
"at least three" — 12× low. Two categories deserve naming because they are easy to miss:

- **Mixin of a moving trait** — e.g. `class PatchSetProtocolSpec … with PatchSetProtocol`. The
  dependency is in the `extends` clause, not an import, and not a call site.
- **Same-package construction** — e.g. `domain/DataSourceSpec` naming 14 moving types with no import.

The authoritative surface is the compiler; these figures are for budgeting.

### D5 — Three package objects, not two

None is an ordinary file; all are invisible to a mapping-driven import rewrite, and their relative
references are invisible to `check-scala-quality.mjs`'s FQN rule.

- **`domain/package.scala` STAYS at `domain/` root**, overriding HEL-633's layout. It is `package
  com.helio; package object domain`, whose **51** type aliases exist (per its own header) so
  `import com.helio.domain._` keeps resolving step types — a wildcard used by **68 main + 73 test = 141**
  files. Filing it under `domain/model/` either renames it to `package object model` (breaking 141 sites)
  or leaves a path that lies about its package. Every alias targets `steps.X`, and `domain/steps/` does
  not move, so **content untouched**.
- **`api/package.scala` stays at `api/` root; its body must be rewritten.** `package object api` with
  **156** `type` aliases (155 `val`s — `AnalyzeStepResponse` is a companionless sealed trait) and **466**
  `protocols.X` occurrences across **312** lines of a 381-line file. It re-exports **only** protocol
  types — it aliases none of the 10 names moving from `api/` root to `api/http/`, so it is not a blanket
  safety net for `import com.helio.api._` (30 main files). Rewriting alias targets changes no type, name
  or arity. The **sole** D6 allow-list entry.
- **`domain/panels/package.scala` needs an added import and is not a mover.** It is `package
  com.helio.domain; package object panels` — genuinely nested, so today it sees `com.helio.domain`
  members. Its only import is `spray.json._`; it references `DataTypeId` and `MetricId`, defined in
  `domain/model.scala` at `:11` and `:837`, which moves to `domain/model/`. After that move it **will not
  compile** without a new import. It holds the only two `implicit val`s in any package object
  (`dataTypeIdFormat`, `metricIdFormat`); these resolve by explicit `import com.helio.domain.panels._`,
  not by implicit scope, so the move does not re-resolve them.

### D6 — Verification is per-file content identity over EVERY file

The invariant for a pure move is **content identity modulo `package`/`import` statements**. Primary gate:
`git show <base>:<path>` and the working file, each passed through the filter below, must be
byte-identical.

**The filter is statement-oriented, not line-oriented — this is load-bearing.** A naive
`grep -vE '^[[:space:]]*(package|import)[[:space:]]'` drops only the *opening* line of a multi-line
braced import and leaves its continuation lines in the compared content. Those continuation lines are
exactly what the rewrite must change (D7a), so a line-oriented filter reports a difference on **41 main +
18 test** correct files — the change would fail its own primary gate. Worst case:
`services/AssistantToolExecutor.scala` imports 15 protocol names in one statement that splits ~6 ways.

The `package` and `import` triggers must be **separate rules**. A combined
`/^[[:space:]]*(package|import)[[:space:]]/` trigger also matches a package-object header
(`package object api {`), which carries `{` without `}` — so brace-swallowing engages and eats the whole
package-object body. That is not hypothetical: it deleted 375 lines from `api/package.scala`, 109 from
`domain/package.scala` and 13 from `domain/panels/package.scala`, and it failed toward **PASS**, blinding
D6 over a live JSON format the executor is directed to hand-edit. The `package` rule is therefore
anchored to end-of-line, which is sound because every one of the 540 files is single-clause (D0) and the
tree contains zero braced `package … { }` blocks.

Save the **program body below** (not the fenced header, and not wrapped in `awk '…'`) to
`baseline/filter.awk`, and invoke it as `awk -f baseline/filter.awk <file>`:

```awk
BEGIN{skip=0}
skip{ if ($0 ~ /}/) skip=0; next }
/^[[:space:]]*import[[:space:]]/ { if ($0 ~ /\{/ && $0 !~ /}/) skip=1; next }
/^[[:space:]]*package[[:space:]]+[A-Za-z_][A-Za-z0-9_.]*[[:space:]]*$/ { next }
{print}
```

Verified before adoption across all **540** `.scala` files: 0 residual `import` lines, **5,649** lines
masked, all three package-object bodies preserved intact (`api/package.scala` 381→380 kept,
`domain/package.scala` 115→114, `domain/panels/package.scala` 33→31), multi-line braced imports still
swallowed correctly, and 0 files where the output differs from an independent parser.

**How the earlier version passed a verification it should have failed** — worth recording, because it is
the reason the self-check in tasks.md is now two-sided. The "independent implementation" it was checked
against re-encoded the *same* trigger regex and brace rule, so both agreed perfectly on the same
specification error; and the stated invariant ("0 residual `package`/`import` lines") is one-sided —
it detects a filter that consumes too little and is trivially satisfied by one that consumes too much.
Agreement between two implementations of one flawed spec is not verification.

This filter is fixed **here, in the design**. It must not be improvised when the gate first fires, and it
must never be loosened in a way that drops non-`import` lines — that single edit would silently disarm
the change's central verification, which is the only thing standing between a 257-file diff and an
unreviewable one.

**Iteration domain: the union of every `.scala` path in the base tree and every `.scala` path in the
worktree** — movers compared old→new via the mapping, non-movers same→same. Defining it over the union
(not the mapping, and not the worktree alone) is what makes an unexpected *added* file at an unmapped
path, or a *deleted* one among the 65 unmapped stay-put files, fail rather than be silently skipped.

Scoping to rename pairs alone would leave ~75 stay-put main files uncovered, including `api/ApiRoutes.scala`
— the 691-line composition root whose `~` mount order is the exact hazard this gate exists to subsume,
and a file this change *must* edit.

**Allow-list — exactly one file may differ, plus added READMEs:** `api/package.scala` (D5). Any second
difference fails the change. With the statement-oriented filter above this is true; under a line-oriented
one it is not.

That single allow-listed file is the only hole in "provably identical", so it gets its own check rather
than a pass: after the rewrite, `sed -E 's/protocols\.[a-z]+\./protocols./g'` applied to the new
`api/package.scala` must be byte-identical to the base file. That collapses the domain segment this change
inserts and proves nothing else in those 381 lines moved. Applied to `backend/src/test/` too, which is what actually enforces "test
diff limited to `package`/`import` lines".

The gate is blind to `import` lines by construction. That is tolerable here for a verified reason: **no
top-level package object in the tree declares an `implicit`** (the only two live in
`domain/panels/package.scala`, reached by explicit wildcard import), and the 41 protocol traits reach
`JsonProtocols` by inheritance (**39 directly**, `PipelineStepProtocol`/`PipelineAnalyzeProtocol`
transitively) rather than by package scope. So no import rewrite can silently re-resolve an implicit.

Supporting: quality-script **set**-equivalence vs the 128 baseline (set, never count). **One expected
delta is pre-authorised:** the soft budget is 250 lines and this change only ever *adds* import lines, so
a file just under the line may cross it. Measured candidates: `infrastructure/DashboardRepository.scala`
(243, needs ≥6 new imports) and `infrastructure/MetricRepository.scala` (246, needs 3). A warned-set delta
consisting **solely** of files crossing 250 by added `import` lines is expected, must be recorded with the
line arithmetic shown, and must **not** be "fixed" — every remedy is forbidden elsewhere (splitting the
file is a Non-goal; inlining an FQN is barred by D7b). Any other set change is a real failure. Note the set is
keyed on basenames because paths change, and three files share the basename `package.scala` — today only
`api/package.scala` (381 lines) is in the warned set, so the key is unambiguous; if a second ever enters,
switch to new-path keys. Plus `sbt test` green with identical test count, and `check-scala-quality.mjs`
clean (it carries `com.helio.` in `FQN_PREFIXES`, guarding inlined FQNs).

**Rejected as insufficient:** route enumeration from `ApiRoutes.scala` (blind to a `~` reorder inside one
of the 48 route files) and `javap` signature diffing (blind to any method-*body* change). Do **not** add
tests asserting files exist at new paths.

### D7 — The import surface: rewrites, and the larger category of insertions

**(a) Rewriting existing imports.** Measured (main | test): `domain._` 68 | 73; `api._` 30 | 0;
`api.routes._` **1 | 1**; `services._` 0 | 6; `infrastructure._` 0 | 19; `api.protocols._` 2 | 10. The
`api.routes._` row is `ApiRoutes.scala:12` — the composition root, and how **~40 route object names**
resolve there; it must fan out across the 13 new route subpackages. Braced `import com.helio.x.{…}`
**opening lines** 240 | 216 — of which only 199 | 195 carry a comma on the opening line; the other **41
main / 18 test are multi-line**, names on continuation lines (e.g. `domain/steps/JoinStep.scala:3-10`).
A line-oriented rewrite sees no names to fan out and silently leaves them — as does a `^import`-anchored
pass over the **43** indented, scope-local imports (0 main / 43 test). **The rewrite must be
statement-oriented, not line-oriented.**

**(b) Inserting imports that do not exist today — the dominant category.** Per D0, every reference that
resolved through package scope breaks. Measured over main (a name defined in another file of the same
flat layer, referenced without an import; comments and string literals stripped): `services/` 58 files /
367 sites, `api/protocols/` 18 / 92, `domain/` root 16 / 95, `infrastructure/` 34 / 82, `api/routes/` 39 /
39 — **≈165 files, ≈675 sites**. An independent count of the same quantity gives **164 files / 507
sites**: the file count corroborates, the site count does not, so treat the magnitude as an estimate and
**the compiler as the authority**.

This explicitly includes references to the stay-put shared files, which are the same case and are easy to
assume safe: **`ServiceError` is referenced by 50 `services/` files, only 3 of which import anything from
`com.helio.services`**; `api/routes/`'s 39 sites are almost entirely `ServiceResponse`; and
`PaginationProtocol`/`IdParsing`/`ResourceProtocol` stay at `api/protocols/` root while the protocols
they name move (`PaginationProtocol.scala` alone names 5 moving protocol traits). The estimate
over-counts only where two files of a layer land in the *same* target subpackage.

These surface as a wall of `not found: value X` on first compile. **This is the precise moment inlining a
fully-qualified name becomes tempting, and it is forbidden** (`CONTRIBUTING.md`,
`feedback_no_inline_fqns`); so is converting the file to nested package clauses (D0.2). Resolve every one
by adding the correct import from `mapping.tsv`, or an import alias on a genuine collision.

**(c) Emission format, decided during execution.** Every import statement this change rewrites is
emitted on a single line — no exceptions, no "preserve the original multi-line shape" heuristic (a
multi-line import that fans out across several new destination packages has no single original shape to
preserve). This is the uniform rule; it is what keeps the quality-tool's warned-set delta explicable
purely by line arithmetic (see `baseline/quality-deltas.md`) rather than by which files happened to be
hand-picked. Checkable by one command:
`grep -rlE '^import com\.helio\.[a-zA-Z.]+\{[^}]*$' backend/src` must return only files this change
never touched.

### D8 — Mapping completeness

The mapping drives moves, rewrites, READMEs and D6. It covers **257** files: the 244 movers, `api/` root
(12), and `services/layout/PanelPacker.scala` (1). Completeness is asserted per root directory; any
unmapped file fails. **Four** non-movers must still be edited and are listed alongside it so they cannot be forgotten:
`api/package.scala` (D5), `domain/panels/package.scala` (D5), `api/ApiRoutes.scala` (D7a), and
**`api/JsonProtocols.scala`** — its line-3 `import com.helio.api.protocols._` is how all **39** direct
`with XProtocol` mixins resolve; once `api/protocols/` splits, that wildcard reaches only the three
stay-put files and the file fails with 39 `not found: type` errors.

### D9 — Two hardcoded logger names stay wrong, deliberately

`AuthoringTelemetry.scala:33` and `AssistantTelemetry.scala:29` call
`LoggerFactory.getLogger("com.helio.services.<Name>")` — string literals the compiler cannot see. The files
land in `proposals`/`assistant`, so the category will no longer match the class. **Leave them untouched**:
editing them renames a live log category, a behaviour change. Verified safe — zero `com.helio` in
`backend/src/{main,test}/resources/`; `logback.xml` declares no `<logger>` elements. **HEL-803** realigns
them. Same reasoning for scaladoc naming a package relationship the split ends (e.g.
`AssistantProposalToolSchemas.scala:22`): prose goes stale rather than the diff going impure.

### D10 — Per-layer green commits, squash, merge order

Each layer is **move → rewrite every import in `backend/src` that names a symbol this layer moved,
wherever it lives → `sbt Test/compile` green → commit**, rather than all seven moves followed by one
rewrite. Two details matter. The rewrite is *tree-wide per layer*, not scoped to the moving layer's own
files — moving `domain/` root alone breaks the 68 main files doing `import com.helio.domain._`, so a
layer-scoped reading makes green unreachable. And the terminal check is `Test/compile`, not `compile`:
plain `compile` cannot see test breakage, which would then accumulate silently until the final `sbt
test` and defeat the point of per-layer commits. This keeps the error surface bounded to one layer at a time instead of
confronting the executor with the whole ~675-site wall at once, and it makes each commit independently
meaningful. Delivery squashes as normal. `git log --follow` is *expected* to survive (only
`package`/`import` lines change) but is **not assumed**: once the squash exists, run it on a moved file
and confirm; if it fails, escalate before Delivery. Merge `origin/main` **before** the gates (CON-129); if
`main` moves after they pass, merge and **re-run them** — the tree that passes the final gate must be the
tree squashed.

### D11 — Recorded documentation drift (not fixed here)

10 files under `openspec/specs/` match `com.helio.(services|infrastructure|api|domain)`. Most reference
`domain.shapes`/`domain.steps`, which do **not** move; the genuinely stale ones name symbols that do.
HEL-775 owns `openspec/specs/`, so this change must not edit it. **HEL-804** records it.

## Risks / Trade-offs

- **An executor "fixes" the import wall with nested package clauses or inline FQNs** → D0.2 and D7(b)
  forbid both by name; `check-scala-quality.mjs` backstops the FQN half.
- **Multi-line/indented imports missed by a line-oriented rewrite** → D7(a); residue is a compile error.
- **Estimates are wrong in magnitude** → they are budgeting aids only; D6 and the compiler are the gates,
  and neither depends on the estimates being right.
- **Scope bleed into HEL-634** → D4 `--name-status` plus D6's content filter over the test tree.
- **`private[services]` implies encapsulation it does not provide** — 117 sites keep `com.helio.services`
  as their scope, so such a member in `services.dashboards` stays reachable from `services.pipelines`.
  The READMEs must not claim otherwise.

## Migration Plan

No deploy, migration or rollback specifics: no runtime artifact changes. Verified: `build.sbt`'s `assembly
/ mainClass := "com.helio.app.Main"` is unaffected (`app/` stays put); zero `com.helio` across
`backend/src/{main,test}/resources/`, `.github/`, or any `META-INF/services`. Rollback is `git revert` of
one squash commit.

## Planner Notes

No blocking open questions: `ai/`-as-infrastructure → HEL-802; logger names → HEL-803; spec drift → HEL-804.

Self-approved: D1–D3 naming (under explicitly delegated authority), D0 and D4–D11 mechanics. Escalated and
answered by the human before drafting: the thirteen-domain amendment, `ai|email|spark|app` scope,
squash-vs-preserve; a dashboard `--await` timed out during it and was treated as **not** an approval.

Five cold review rounds produced: D5–D9/D11 (round 1); D7(b), D3's `ServiceResponse` reversal, the third
package object, D6's rescoping (round 2); **D0** (round 3), after a compile test disproved a claim this
document had asserted about Scala scoping — the same rule it applied correctly in D5; and two successive
defects in D6 itself (rounds 4 and 5), first a line-oriented filter that would have failed the gate on 59
correct files, then a combined `package|import` trigger that silently ate 497 lines of three
package-object bodies while failing toward PASS.

Two distinct failure patterns are recorded here deliberately. Rounds 1–3 each found a headline count that
excluded the harder instances of the class it named (wildcards, multi-line braced imports, zero-import
test files at 3 vs 35) — answered by naming the compiler, not the estimate, as the authority (D4, D7b).
Rounds 4–5 both found defects in **the verification gate itself**, which no other gate can catch by
construction — answered by fixing the filter here in the design and by making its self-check two-sided.
Round 5's budget overrun was escalated and the human granted one extra round; it was not self-authorised.

**Deliberate deviation:** this document exceeds openspec's 150-line guidance. Three review rounds produced
26 blocking defects, each needing a recorded decision; reaching 150 now means deleting one.
