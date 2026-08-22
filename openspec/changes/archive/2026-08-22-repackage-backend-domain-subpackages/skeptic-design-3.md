# Skeptic Report — design gate (round 3, skeptic-design-3.md)

Worktree: `/home/matt/Development/helio/.claude/worktrees/task/repackage-backend-domain-subpackages/HEL-633`
Base: `29fc0528`. Fresh cold instance. Every figure below is from a command I ran in this worktree, or
from a program I compiled with the project's own Scala compiler. Nothing is taken from `skeptic-design-1.md`,
`skeptic-design-2.md`, or the artifacts.

---

## Part A — are round 2's nine CRs genuinely addressed?

| CR | Claim to check | My measurement | Verdict |
|---|---|---|---|
| CR-1 | braced opening lines 240 \| 216; multi-line 41 \| 18 | `grep -c '^import com\.helio\.[A-Za-z0-9_.]*\{'` → **240 / 216**; without `}` on the opening line → **41 / 18**; comma on opening line → **199**; indented → **0 main / 43 test** | **Fixed** — D7(a) and tasks.md:31-32 now carry every one of these, and say "statement-oriented, not line-oriented" |
| CR-2 | a task exists for *inserting* imports | D7(b) + tasks.md:37-44 exist | **Present but built on a false premise — see CR-1 below** |
| CR-3 | three zero-import test files | all three exist, all have **0** `com.helio` imports, all `package com.helio.api` — but there are **35** such files, not 3 | **Not fixed — see CR-3 below** |
| CR-4 | `domain/panels/package.scala` is a third package object | `package com.helio.domain` + `package object panels`, only import `spray.json._`, references `DataTypeId`/`MetricId`, defined at `domain/model.scala:11` and `:837`; holds the only two `implicit val`s in any package object | **Fixed, and the reasoning is exactly right** |
| CR-5 | D6 covers stay-put files | D6 now reads "every `.scala` file under `backend/src/`", movers old→new, non-movers same→same | **Fixed** (one residual gap, CR-7 below) |
| CR-6 | `statusCodeFor` has three callers | `ServiceResponse.scala:76` `private[routes] def statusCodeFor`; callers `RefinementRoutes:46,48`, `DashboardAuthoringRoutes:59,61`, `AssistantConversationRoutes:253` | **Fixed** — D3's line numbers are exact |
| CR-7 | `Database`/`DbContext` placement | D3 picks `infrastructure/persistence/` root; `ticket.md` now says the same and names the superseded draft | **Fixed** |
| CR-8 | proposal's mover count | ground truth: services 88, api/routes 48, api/protocols 46, infrastructure **40**, domain root 22 = **244**; +api root 12 +services/layout 1 = **257**; tree total **322** | **Fixed in proposal.md, re-broken in ticket.md — see CR-4 below** |
| CR-9 | consider leaving `ServiceResponse` at `api/routes/` root | adopted | **Adopted on a false premise — see CR-1 below** |

Also re-verified independently and **correct**: `api/package.scala` 381 lines / 156 `type` / 155 `val` /
**466** `protocols.` occurrences; `domain/package.scala` 51 aliases with **all 102** alias targets
matching `= steps.` (so "content untouched" holds); **39** direct `JsonProtocols` mixins;
`check-scala-quality.mjs` → `clean (128 soft warning(s))`, exit 0, `AGGREGATOR_FILES` pinned to the
stay-put `api/JsonProtocols.scala`; D1's 70-file classification reproduces **exactly** (PatchSet 21,
Authoring 12, Assistant 12, Refinement 8, Agent{Memory,Preferences} 8, Metric 4, CombinedProposal 3,
ChatAccess 2 = 70) over the **222** files in the four flat layers; `ApiRoutes.scala`'s explicit lists are
indeed **44** services names and **30** infrastructure names; zero `com.helio` in
`backend/src/{main,test}/resources` / `.github` / any `META-INF/services`; `build.sbt:26`
`assembly / mainClass := Some("com.helio.app.Main")`; **19** archived changes carry no `specs/`,
including all five named precedents; **10** `openspec/specs` files name `com.helio` packages; HEL-802
exists in Linear with an accurate body. Mapping arithmetic is exhaustive: 257 mapped + 65 unmapped
(ai 10, app 5, email 3, spark 2, domain/{panels 12, shapes 9, steps 24}) = 322. `tasks.md:51`'s README
list is complete — `api/`, `app/`, `infrastructure/` are the only READMEs that survive
(`security/README.md` is the fourth and is deleted with the package).

---

## Part B — the new material, checked against ground truth

### The central new decision (CR-9's adoption) rests on a claim about Scala that is false

D3 says, of keeping `ServiceResponse.scala` at `api/routes/` root:

> "`com.helio.api.routes` stays enclosing for `routes.<domain>`, so `private[routes]` still compiles
> and **all 41 references still resolve with no import**."

I tested this with the project's exact compiler (`scalaVersion := "2.13.15"`, jar from the coursier
cache), not by reasoning about it:

```scala
// A.scala
package com.helio.api.routes
object ServiceResponse {
  private[routes] def statusCodeFor(e: String): Int = 200
  def completeIt(x: String): String = x
}
// B.scala  — single-clause deep package, no import (what the mapping produces)
package com.helio.api.routes.dashboards
object DashboardRoutes {
  val a: String = ServiceResponse.completeIt("x")
  val b: Int = ServiceResponse.statusCodeFor("y")
}
```

```
B.scala:5: error: not found: value ServiceResponse
B.scala:6: error: not found: value ServiceResponse
```

Reproduced twice, plus a two-levels-up control (`com.helio.api.routes.assistant` → `com.helio.api`'s
`RequestValidation`) which fails identically. A **single-clause** `package a.b.c` declaration does not
open the enclosing packages' scopes. Only lexical nesting does; I verified the positive control
compiles clean:

```scala
package com.helio.api.routes
package dashboards          // ← two clauses: nesting, no import needed, private[routes] OK
```

and that the single-clause form **with** an explicit import compiles clean too — so the
`private[routes]` half of D3's claim is **true** (qualified-private is package-membership, not lexical
scope), and the "no import" half is **false**.

This is not academic. Every one of the 540 `.scala` files in `backend/src` uses the single-clause form —
`grep -c '^package '` returns 1 for all of them except the three package-object files. The design
already models this correctly in one place (D5 correctly deduces that `domain/panels/package.scala`
breaks *because* it is lexically nested inside `package com.helio.domain`) and incorrectly in another
(D3/D7b). Ground truth for the consequence: `grep -lw ServiceResponse api/routes/*.scala` → **41**
files, and **0** of them import it.

### The insertion figures

My independent measurement (distinct `(file, name)` pairs, comments and string literals stripped, names
already imported excluded):

| layer | plan says (files/sites) | I measure (files/pairs) | note |
|---|---|---|---|
| `services/` | 58 / 367 | **60 / 217** | 43 of the pairs are `ServiceError` (49 files reference it, 3 import anything from `com.helio.services`) |
| `api/routes/` | 39 / 39 | **39 / 39** | **38 of the 39 pairs are `ServiceResponse`** |
| `api/protocols/` | 18 / 92 | **18 / 93** | matches |
| `domain/` root | 16 / 95 | **14 / 98** | matches |
| `infrastructure/` | 34 / 82 | **33 / 60** | 24 pairs are `DbContext` |
| **total** | **~165 / ~675** | **164 / 507** | file count corroborated almost exactly; site count is not |

So the method is sound in *shape* — distinct `(file, name)` pairs is the right unit, because it equals
the number of import lines to add, and it is the unit an executor can act on. Two things are wrong with
it as stated:

1. The stated reason the number is "an upper bound" — "some names are supplied by a layer's stay-put
   files" — is the false premise above. Stay-put layer-root files supply **nothing** to a subpackage.
   The real over-count reason (two files in the same layer that land in the *same* target subpackage
   need no import) is never mentioned.
2. The plan's own `api/routes` row (39/39) is 38× `ServiceResponse` — i.e. the table already counts the
   imports D3 says are unnecessary. One of the two must be corrected; they cannot both stand.

### The D6 gate

Scoping it to every `.scala` under `backend/src/` is the right call and closes CR-5. One residual class
it cannot see, and one it cannot see *by construction*:

- **Iteration domain unstated.** "Movers old→new, non-movers same→same" enumerates from the mapping and
  the worktree. A `.scala` file **added** at a path that is neither (no base counterpart for
  `git show <base>:<path>`) or **deleted** from the 65 unmapped stay-put files has no defined outcome.
- **Import correctness is invisible by construction** — the filter strips exactly the lines this change
  edits. D6 proves "nothing *else* changed"; only `sbt compile`/`sbt test` prove the imports are right.
  I checked whether that hole is dangerous here and it is **not**: `grep -rE '^\s{0,2}(implicit (class|def|val))'`
  over the five flat layers finds no top-level, package-scoped implicit — every implicit sits inside an
  object or trait, and the 41 protocol traits reach `JsonProtocols` by inheritance (39 directly). So no
  added import can silently re-resolve an implicit. The design's premise-check earns its place; it just
  doesn't say that this is what makes D6's blind spot survivable.

### Executability

Mechanically executable by one executor — the work is compiler-guided and the decomposition is right.
Two real costs the plan does not price:

- **Ordering guarantees one big-bang compile.** All seven `git mv` commits precede any rewrite
  (tasks.md:20-26 before 28-44), so nothing compiles until the entire rewrite is done: ~507+ import
  insertions, ~456 braced statements to fan out, 466 alias targets, 143 + 35 test files, all resolved
  against a single error wall with no green checkpoint anywhere. A layer-at-a-time
  move → rewrite → `sbt compile` green sequence is available, loses nothing (the branch is squashed
  anyway, and per-layer commits stay just as reviewable), and converts one unbounded debugging session
  into seven bounded ones.
- **The READMEs are unquantified.** The 13 domains across `services/`, `api/routes/`, `api/protocols/`,
  `infrastructure/persistence/`, plus `api/http`, `storage`, `crypto`, `concurrency`, `persistence` root
  and `domain/{model,connectors,engine,util}` is on the order of **50 new directories**, each needing a
  README verified against its actual final contents (an explicit acceptance criterion). Every other
  block of work in this plan is counted; this one is a bare "write a README in each created directory".

---

## Verdict: REFUTE

Round 2's CRs are, on the whole, addressed with real rigour — D1's 70, D5's third package object, D6's
rescoping, the `Database`/`DbContext` tie-break, the multi-line-import figures and the `statusCodeFor`
line numbers all reproduce exactly under my own commands. This is a genuinely strong plan.

But the one decision the planner was asked to scrutinise hardest — the newly adopted CR-9 reversal — is
justified by a statement about Scala scoping that the compiler contradicts, and the same false premise
is load-bearing in D7(b)'s hedge and in the `api/routes` insertion figure. The outcome of the decision
survives (staying put still avoids the only access-qualifier edit), but the executor is currently told
that 41 imports will not be needed, at exactly the point where D7(b) warns them that unexpected
`not found` errors are the moment inlining an FQN becomes tempting. And CR-3's fix names 3 test files
where the true figure is 35 — the third round in a row where a headline count excludes the harder
instances of the class it names.

---

## Change Requests

### CR-1 (blocking) — D3's "all 41 references still resolve with no import" is false; correct it without reversing the decision

`design.md:52-62`. Compile-verified above with Scala 2.13.15: a file declaring
`package com.helio.api.routes.dashboards` (single clause — the style of all 540 files in
`backend/src`) cannot see `com.helio.api.routes.ServiceResponse`. All **41** route files that reference
it (0 of which import it) will need `import com.helio.api.routes.ServiceResponse` after the move into
`api/routes/<domain>/`.

Required:
1. Keep the decision — it still wins on the half of the rationale that is true: `private[routes]`
   remains accessible from `com.helio.api.routes.<domain>` (compile-verified), so moving the file would
   still force the change's only access-qualifier edit. Delete or rewrite claim (b) and the
   "single highest-leverage placement" framing that rests on it.
2. State explicitly that moved files keep the **single-clause** `package <new FQN>` form from the
   mapping, and that adopting the two-clause nesting form to dodge imports is **not** permitted — it
   would widen name resolution for the whole file, which is a behaviour-adjacent change under an iron
   constraint that forbids exactly that.
3. Apply the same correction wherever the premise recurs: D7(b)'s
   "some names are supplied by a layer's stay-put files" (`design.md:159-160`) is false as a reason for
   the estimate being an upper bound.

### CR-2 (blocking) — the insertion table and D3 contradict each other; reconcile and re-hedge

`design.md:156-160` / `tasks.md:41`. The `api/routes 39/39` row is **38 pairs of `ServiceResponse`** by
my measurement — the plan already counts the imports D3 says are unnecessary. Required:
1. Pick one and make the artifacts agree. (Correct answer per CR-1: the 39/39 stands, D3's claim goes.)
2. Say the same thing for the other stay-put shared files, because they are the same case:
   `services/ServiceError.scala` is referenced by **49** services files with only **3** importing
   anything from `com.helio.services` (43 distinct pairs in my count), and
   `api/protocols/{IdParsing,PaginationProtocol,ResourceProtocol}.scala` stay at their root while the
   protocols they name move — `PaginationProtocol.scala` alone references 11 moving protocol names
   through same-package scope today.
3. Replace the false hedge with the true one: the figure over-counts where two files of a layer land in
   the **same** target subpackage, and under-counts nothing that `sbt compile` will not surface. Label
   it an estimate and make the compiler the authority (tasks.md:40 already does this — say it in
   design.md too). For calibration, an independent count of the same quantity gives **164 files / 507
   pairs** against the plan's ~165 / ~675; the file count corroborates, the site count does not.

### CR-3 (blocking) — the zero-`com.helio`-import test surface is 35 files, not 3

`design.md:79-85` ("at least three more") and `tasks.md:56` ("Fix the **3** test files with ZERO
`com.helio` imports"). Ground truth: **74** test files carry no `com.helio` import at all, and **35** of
them reference a name from their own package that moves — so they will not compile. Measured
conservatively (same-package resolution only; stay-put files excluded from the mover set):

- `domain/` — 16 files: `DataFieldTypeSpec`, `DataSourceSpec` (14 moving names), `ConnectorSpec`,
  `ConnectorRegistrySpec`, `SqlConnectorSpec`, `RestApiConnectorSpec`, `NewConnectorInferenceSpec`,
  `SchemaInferenceEngineSpec`, `ExpressionEvaluatorSpec`, `PanelAppearanceMergeSpec`, `PanelTypeSpec`,
  `PipelineStepSpec`, `PipelineRowJsonSpec`, `PipelineSchemaDriftSpec`, `CronScheduleSpec`, `UserTierSpec`
- `services/` — 6: `AssistantSystemPromptSpec`, `DashboardAuthoringParsingSpec`, `ImageSourceSupportSpec`,
  `PipelineShapeServiceSpec`, `UserTierConfigSpec`, `WorkspaceAssistantToolsSpec`
- `infrastructure/` — 5: `DbContextSpec`, `DataTypeRowRepositorySpec`, `GcsFileSystemSpec`,
  `LocalFileSystemSpec`, `TotpSupportSpec`
- `api/protocols/` — 4: `PatchSetProtocolSpec`, `AssistantProposalToolSchemasSpec`,
  `DashboardProposalProtocolSpec`, `PipelineProposalProtocolSpec` (note these **mix in** moving traits —
  `class PatchSetProtocolSpec ... with PatchSetProtocol` — a category the plan never names)
- `api/routes/` — 1: `PipelineRunRegistrySpec`
- `api/` — the 3 already named

Required: correct the count in D4 and `tasks.md:56`, and name the mixin-of-a-moving-trait case. The rule
in `tasks.md:57` ("every test file that fails to compile is the authoritative surface") is right and
should stay — but a stated magnitude that is 12× low is the same defect this gate refuted in rounds 1
and 2.

### CR-4 (blocking, one word) — `ticket.md` still carries the stale `infrastructure/ 39`

`ticket.md`, "Measured ground truth": "`infrastructure/` **39** … Movers in the four flat layers: 222".
Ground truth is **40** (`find infrastructure -maxdepth 1 -name '*.scala' | wc -l`), which is also what
`design.md:5` and `tasks.md:13` use, and what ticket.md's own "222" requires (88+48+46+**40**). This is
CR-8's defect class re-appearing in the artifact CR-8 did not touch.

### CR-5 (blocking) — `ApiRoutes.scala`'s `import com.helio.api.routes._` is missing from both the census and the task

`design.md:145-146`'s wildcard census lists `domain._`, `api._`, `services._`, `infrastructure._`,
`api.protocols._` — there is no row for `com.helio.api.routes._`, which exists in **1 main + 1 test**
file. The main one is `api/ApiRoutes.scala:12`, the composition root, and it is how **~40 route object
names** resolve there. `tasks.md:34` tells the executor to rewrite that file's *explicit* lists
(services 44 / infrastructure 30 — both verified correct) and to add its `api.http` imports, but never
mentions expanding the routes wildcard into the 13 new subpackages. Required: add the row and the task
clause.

### CR-6 (blocking, cheap) — the thirteen domain names are never enumerated in any change artifact

`tasks.md:14` says "Assert every target is one of the **13 domains**". `design.md:25` names only the
five that were added (`metrics`, `assistant`, `agents`, `proposals`, `patchsets`); the original eight
(`alerts`, `auth`, `dashboards`, `panels`, `pipelines`, `sources`, `workspace`, `hooks`) appear only in
HEL-633's Linear body, and `ticket.md` — the local copy — drops them. The most load-bearing vocabulary
in the change ("spelled identically in every layer") is not written down where the executor works.
Required: enumerate all 13 once, in `ticket.md` or `design.md` D1.

### CR-7 (non-blocking-if-you-prefer, but cheap) — state D6's iteration domain

`design.md:117-119`. Define the gate's domain as the **union** of base-tree `.scala` paths and worktree
`.scala` paths, so that a file added at an unmapped path (no base counterpart) or deleted from the 65
unmapped stay-put files **fails** rather than being silently skipped. As written the gate is defined
only over the mapping and the worktree.

### CR-8 (executability) — sequence the work so the tree is green after each layer, and price the READMEs

1. `tasks.md:20-26` performs all seven moves before any rewrite, so the executor meets the entire error
   surface at once with no intermediate green state. Restructure to per-layer
   move → rewrite (main + test) → `sbt compile` green → commit. D10's "reviewable commits" rationale is
   preserved or improved, and the squash makes the shape of the intermediate commits moot anyway.
2. Add a task quantifying the README work (~50 new directories) so it is budgeted like every other block
   in this plan, and so "verify each README against actual contents" is not the last thing left when the
   compile is finally green.

---

## Non-blocking notes

- **`DbContext` in 120 files** is main+test; main alone is 31. Both are true; D3 should say which, since
  round 2 measured 31 and a future reader will otherwise think one of you was wrong.
- **`model.scala` is 989 lines**, not 990 (`proposal.md`).
- **Quality gate on basenames** (`tasks.md:6,62`) is the right call given paths change, but note three
  files share the basename `package.scala`; if any two ever enter the warned set, set-equivalence on
  basenames goes blind. `api/package.scala` (381 lines) is presumably in the 128 today; the other two
  are not.
- **The 150-line trade is fine.** Eleven decisions, three review rounds; padding it back under the cap
  would cost information. Flagging it was right.
- **D5's treatment of `domain/panels/package.scala` is the best reasoning in the document** — it derives
  the breakage from lexical nesting, which is precisely the rule D3 then mis-applies. Fixing CR-1 is
  mostly a matter of making D3 agree with D5.
- **Credit:** D1's 70 reproduces exactly; the 244/257/322 arithmetic is exhaustive against the tree;
  `tasks.md:51`'s README list is complete; the no-top-level-implicits property (which I checked
  independently) is what actually makes this refactor safe from silent implicit re-resolution, and it is
  worth stating in D6 as the reason its import-blindness is tolerable.
