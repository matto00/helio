# Skeptic Report — design gate (round 2, skeptic-design-2.md)

Worktree: `/home/matt/Development/helio/.claude/worktrees/task/repackage-backend-domain-subpackages/HEL-633`
Base: `29fc0528`. Fresh cold instance — every figure below is from my own command run in this
worktree, not from the artifacts or from `skeptic-design-1.md`.

## What I verified (with evidence)

**Tree shape.** Per-directory `.scala` counts (`find -maxdepth 1`): `services` 88, `api/routes` 48,
`api/protocols` 46, `infrastructure` **40**, `domain` root 22, `api` root 12, `services/layout` 1;
total 322. Movers 88+48+46+40+22 = **244**; mapped 244+12+1 = **257**. Design's Context line is
correct. CR-7.1 (39→40) fixed.

**Test tree.** 218 `.scala`; 143 match `^import com\.helio\.(api|services|infrastructure|domain)`. Both confirmed.

**Quality baseline.** `node scripts/check-scala-quality.mjs` → `Scala code-quality check: clean (128 soft warning(s))`, exit 0. Confirmed.
`AGGREGATOR_FILES` pins `api/JsonProtocols.scala` (script line 30); `FQN_PREFIXES` carries `com.helio.` (line 33). Both design claims hold.

**D5 / CR-1 — `domain/package.scala`.** `package com.helio` + `package object domain`; **51** `type`
aliases and 51 `val` aliases over 115 lines. `import com.helio.domain._` → **68 main + 73 test = 141**
files. All aliases target `steps.X`, and `domain/steps/` does not move, so "Content untouched" is
**correct**. Addressed correctly.

**D5 / CR-2 — `api/package.scala`.** 381 lines; 156 `type … = protocols.X`; 155 `val`; 312 lines
contain `protocols.`; **466** total `protocols.X` occurrences. Confirmed load-bearing and confirmed
invisible to both the import rewrite and the FQN checker.

**D7 / CR-4 — wildcards.** Measured (main | test): `domain._` 68|73, `api._` 30|0, `services._` **0**|6,
`infrastructure._` **0**|19, `api.protocols._` 2|10. All five match the revised D7 exactly. Indented
`com.helio` imports: **43** (0 main, 43 test) — matches.

**D1 / CR-7.2 — the 70.** Mutually-exclusive substring classification over the 222 files in the four
flat layers gives PatchSet 21, Authoring 12, Assistant 12, Refinement 8, AgentMemory 4 +
AgentPreferences 4, Metric 4, CombinedProposal 3, ChatAccess 2 = **exactly 70**. Reproduced. The
round-1 arithmetic defect is genuinely fixed, not papered over.

**D3 / CR-7.3.** `grep -rl DashboardProposalService backend/src/main` → **24** files.
`grep -c DashboardProposal services/DashboardServiceValidation.scala` → **0**. The design's explicit
retraction is accurate.

**D6 / CR-7.4 — mixins.** `trait JsonProtocols extends …` block has **39** direct `extends`/`with`
entries; 41 `*Protocol` traits exist. "39 directly" is right.

**D9 / CR-8 — loggers.** `AuthoringTelemetry.scala:33` and `AssistantTelemetry.scala:29` are exactly
`LoggerFactory.getLogger("com.helio.services.<Name>")`. Zero `com.helio` in
`backend/src/{main,test}/resources`; `logback.xml` has 0 `<logger` elements. **HEL-803 exists** in
Linear and its body is accurate. Addressed correctly.

**D11 / CR-9 — spec drift.** `grep -rlE 'com\.helio\.(services|infrastructure|api|domain)' openspec/specs`
→ exactly **10** files. **HEL-804 exists** and its body is accurate (including the correct caveat that
`domain.shapes`/`domain.steps` do not move). `HEL-802` also filed. Addressed correctly.

**Migration Plan claims.** 0 `com.helio` in `backend/src/{main,test}/resources`, 0 in `.github/`,
0 `META-INF/services` dirs under `backend/`; `build.sbt:26` = `assembly / mainClass := Some("com.helio.app.Main")`.
All verified true.

**Access qualifiers.** `private[services]` 117, `private[infrastructure]` 8, `private[protocols]` 2,
`private[api]` 2, `private[domain]` 1 — all confirmed, and all keep an enclosing package after their
moves (`private[api]` is in `api/TraceContextDirective.scala` → `api/http/`; `private[domain]` in
`domain/Panel.scala` → `domain/model/`). The D5 safety claim holds. **`private[api]` erasure claim is
true** — Scala qualified-private is emitted public in JVM bytecode, so the widening is runtime-neutral.

**Package objects.** `grep -rn 'package object'` over main returns **three**, not two:
`domain/package.scala`, `api/package.scala`, and **`domain/panels/package.scala`** (see CR-4 below).
Neither `package object domain` nor `package object api` contains any `implicit`, so no implicit-scope
migration hazard exists for the moved types — a real strength of the plan that it does not claim.

**Where the plan breaks — all reproduced with a second, independent method:**

| Check | Design says | Measured (script) | Measured (grep-only re-run) |
|---|---|---|---|
| braced `import com.helio.x.{…}` main | 199 | 240 | **240** |
| braced main, comma on opening line | — | 199 | **199** |
| braced main, multi-LINE | — | 41 | **41** |
| braced test | 195 | 216 | **216** |
| braced test, multi-LINE | — | 18 | **18** |
| `api/routes/*` referencing `ServiceResponse` | "both callers" | 41 | **41** |
| …of those, importing it | — | 0 | **0** |
| `statusCodeFor` external callers | 2 | 3 | **3** |

---

## Verdict: REFUTE

Round 1's nine CRs are, with two exceptions, genuinely and often excellently addressed — D1's 70,
D3's retraction, D5's pinning of `domain/package.scala`, D9, D11 and the two filed spinoffs are all
verifiably correct, and D6's content-identity gate is the right instrument. I want to be clear that
this is a much stronger document than round 1's.

But the revised plan still mis-measures the work it exists to direct, and does so in the *same shape*
as round 1: a headline figure that names a real trap while silently excluding the harder instances of
it. Specifically, the plan has **no task at all** for the single largest mechanical category in the
change — the import lines that must be **added** to files that today resolve a name through package
scope with no import. That is 41 route files for `ServiceResponse` alone. It is cheap to fix now and
expensive to discover under a red compiler across 257 moved files.

---

## Change Requests

### CR-1 (blocking) — the braced-import figure excludes the multi-line braced imports, which are the harder case

D7 states "braced multi-name `import com.helio.x.{A, B, …}` **199** | 195" and the headline "The bulk
work is braced-import fan-out (**394** lines…)". Measured:

- opening `import com.helio.….{` lines: **240 main / 216 test**
- with a comma on the *opening* line: **199 / 195** ← the design's figure
- **multi-LINE** (no closing `}` on the opening line): **41 main / 18 test = 59 excluded**

The 59 excluded imports are multi-name imports whose names sit on *continuation* lines. Verified
example — `backend/src/main/scala/com/helio/domain/steps/JoinStep.scala:3-10`:

```scala
import com.helio.domain.{
  DataSourceId,
  PipelineExecutionContext,
  PipelineId,
  PipelineRowJson,
  PipelineStep,
  PipelineStepId
}
```

This is exactly the failure mode D7 congratulates itself for catching one paragraph earlier ("a
`^import`-anchored rewrite silently skips every one"): a *line*-oriented rewrite that reads only the
opening line sees no names to fan out and leaves all six behind. I hit this trap myself — my first
analysis pass produced false positives precisely because it only inspected opening lines.

Required: correct the figures to 240 | 216, and name **multi-line braced imports (41 main / 18 test)**
as a third sharp edge alongside indented and wildcard imports, with the instruction that the rewrite
must be statement-oriented, not line-oriented.

### CR-2 (blocking) — the plan has no task for *adding* imports; this is the largest category of work in the change

Every task in "package and import rewrite" rewrites **existing** import lines from `mapping.tsv`. But
the dominant effect of splitting a flat package is that references which resolved through *package
scope* — with no import line at all — stop resolving. A mapping-driven rewrite of existing import
lines cannot add what is not there.

Measured, main tree, sibling references with **no** import today, excluding names in files that stay
at their layer root:

| layer | files affected | name references |
|---|---|---|
| `services/` | 44 | 132 |
| `api/routes/` | 39 | 39 |
| `api/protocols/` | 16 | 78 |
| `infrastructure/` | 17 | 35 |
| `domain/` root | 16 | 65 |

The cleanest instance: **41 files in `api/routes/` reference `ServiceResponse`; 0 of them import it.**
`ServiceResponse` moves to `api/http/` (tasks.md:24), which is not an enclosing package of
`com.helio.api.routes.<domain>` — so **all 41 need a new import line**. tasks.md:36 mentions only
"verify both callers compile", which is about `statusCodeFor`, not about the 41 references to the
object itself.

Second instance: the 9 `api/` root files moving to `api/http/`. `api/package.scala` aliases **none** of
their names (verified: 0 occurrences of `RequestValidation`, `AuthDirectives`, `CookieConfig`,
`SessionCookies`, `AclDirective`, `ResourceType`, `ResourceTypeRegistry`, `AccessCheckerImpl`,
`TraceContextDirective`, `TopLevelErrorHandlers` in that file). So D5's "it keeps
`import com.helio.api._` (30 main files) working" is true **only for the protocol re-exports** and reads
as a blanket safety claim that it is not. 11 main files + 17 test files use one of those 10 names with
no import for it — including `api/ApiRoutes.scala`, which needs new imports for 8 of them.

Required: a design paragraph and a task covering newly-required import **insertions**, with the
measured per-layer surface above, distinct from the existing-import rewrite.

### CR-3 (blocking) — three test files are outside the "143" and will not compile

The plan's test surface is "the 143 affected test files", defined by carrying an
`^import com.helio.(api|services|infrastructure|domain)` line. Three test files declare
`package com.helio.api`, use a name that moves to `api/http/`, and carry **zero** `com.helio` import
lines — so they are outside the 143 and outside every task:

- `backend/src/test/scala/com/helio/api/ImageFitValidationSpec.scala` — calls `RequestValidation.validateImageFit(...)`; 0 `com.helio` imports
- `backend/src/test/scala/com/helio/api/CookieConfigSpec.scala` — uses `CookieConfig` / `SessionCookies`; 0 `com.helio` imports
- `backend/src/test/scala/com/helio/api/TraceContextDirectiveSpec.scala` — uses `TraceContextDirective`; 0 `com.helio` imports

Required: define the test surface by *what needs editing*, not by "has a `com.helio` import line", and
state the corrected count.

### CR-4 (blocking) — `domain/panels/package.scala` is a third package object, outside the mapping, that must be edited

D5 is titled "Two package objects" and enumerates them exhaustively. There are three.
`backend/src/main/scala/com/helio/domain/panels/package.scala` is `package com.helio.domain;
package object panels`, and it references `DataTypeId` (lines 14-18) and `MetricId` (lines 26-31) with
**no import** — its only import is `spray.json._`. Both types are defined in `domain/model.scala`
(`:11` and `:837`), which moves to `domain/model/`. After the move the enclosing package
`com.helio.domain` no longer supplies them and this file **will not compile**.

It is not a mover, so it is not among the 257 mapped files, not a rename pair, and therefore not
covered by D6's gate. Fixing it needs only an added import (permitted), but nothing in the plan
directs the executor there. It also carries the only two `implicit val`s in any package object in the
tree, which makes it worth an explicit decision rather than a silent edit.

Required: name it in D5 and in the mapping-completeness assertion.

### CR-5 (blocking) — D6's gate does not cover any main file that stays put, including `ApiRoutes.scala`

D6 scopes the content-identity filter to "every rename pair", plus `backend/src/test/`. That leaves
every **stay-put main file** uncovered — roughly 75 files: the 65 outside the mapping (`ai/` 10,
`app/` 5, `email/` 3, `spark/` 2, `domain/{panels,shapes,steps}` 45) plus the ~10 mapped files that
stay at their layer root (`ApiRoutes`, `JsonProtocols`, `api/package.scala`, `ServiceError`,
`IdParsing`, `PaginationProtocol`, `ResourceProtocol`, `Database`, `DbContext`, `domain/package.scala`).

That includes `api/ApiRoutes.scala` — 692 lines, the route-composition root, the one file whose `~`
mount order D6 explicitly names as the hazard ("blind to a `~` reorder") that content identity is
supposed to subsume. Under the gate as written, it is subsumed by nothing. It is also a file this
change must edit (8 new `api.http` imports per CR-2), so "it wasn't touched" is not an answer.

Required: scope the filter to **every** `.scala` file under `backend/src/` — movers compared
old-path→new-path, non-movers compared same-path→same-path. Strictly stronger, and a one-line change
to the gate definition.

### CR-6 (blocking, cheap) — `statusCodeFor` has three callers, not two

D5 says it is "called from `RefinementRoutes` and `DashboardAuthoringRoutes`". There is a third:

```
api/routes/AssistantConversationRoutes.scala:253:  case Left(e) => complete(ServiceResponse.statusCodeFor(e), ErrorResponse(e.message))
```

(Full call sites: `RefinementRoutes.scala:46,48`, `DashboardAuthoringRoutes.scala:59,61`,
`AssistantConversationRoutes.scala:253`.) The **decision is unaffected** — all three are under
`com.helio.api.routes.*`, so `private[api]` covers them. But tasks.md:36 instructs the executor to
"verify **both** callers compile", which checks 2 of 3. Fix the count in D5 and the task.

### CR-7 (blocking) — `Database` / `DbContext` placement is unspecified and the two sources contradict

tasks.md:21 says "Move `infrastructure/` into `infrastructure/{persistence/<domain>,storage,crypto,concurrency}/`"
without saying where `Database` and `DbContext` land. The two available sources disagree:

- HEL-633's Linear layout puts them under `persistence/`: "`persistence/{alerts,…}/ + Database, DbContext`"
- the change's `ticket.md` acceptance criterion lists them among the shared files permitted to sit
  **directly in** `infrastructure/`

`DbContext` is referenced in **31** files, so the choice materially changes the import rewrite.
Left as-is this is an executor coin-flip at exactly the kind of decision D9 exists to prevent.
Required: pick one explicitly in the design, as D3/D5/D8 already do for other ticket overrides.

### CR-8 (blocking, cheap) — proposal.md contradicts itself on the mover count

`proposal.md:5`: "Five flat backend layers hold **222** of 322 Scala files". 222 is the **four**-layer
count (88+48+46+40); five layers is **244**, which `proposal.md:55` itself states. This is the same
defect class round 1 blocked on in CR-7 and it is one word to fix.

### CR-9 (blocking, judgment) — reconsider moving `ServiceResponse` at all

D5 frames the options as `private[api]`, `private[http]`, or "abandon the move", and picks the first.
A fourth option is not considered: **leave `ServiceResponse.scala` at `api/routes/` root** and add it
to the shared-files list, exactly as the design already overrides the ticket in D1 (thirteen domains),
D3 (`DashboardProposalService`), D5 (`domain/package.scala`) and D8 (`TopLevelErrorHandlers`).

That option is better on both of the axes this change is optimising:

1. it removes the **only** access-qualifier edit, restoring "no signature changes" to literally true
   and shrinking the D6 allow-list from two files to one;
2. it removes **41** new import lines (CR-2), since all 41 route files keep resolving it through the
   still-enclosing `com.helio.api.routes`.

The cost is one more name on the shared-files list — and `ServiceResponse` genuinely is shared
infrastructure for the routes layer, which is the same rationale that keeps `ServiceError` at
`services/` root and `IdParsing`/`PaginationProtocol`/`ResourceProtocol` at `api/protocols/` root.

I am not mandating the outcome — the ticket does say `api/http/`, and `private[api]` is defensible.
Required is that D5 record this option and say why it was rejected, rather than presenting three
options as exhaustive.

---

## Non-blocking notes

- **`api/package.scala` precision.** "156 alias pairs" is 156 `type` aliases but 155 `val`s —
  `AnalyzeStepResponse` (line 236) is a sealed trait with no companion, documented in-file. And "312
  relative `protocols.X` references" is 312 *lines* / **466** occurrences; one alias spans two lines
  (99-100). None of this changes the action, but an executor who rewrites 466 occurrences and expected
  312 will stop and wonder.
- **D6 forces some scaladoc to go stale**, the same way D9 accepts for logger strings. Example:
  `api/protocols/AssistantProposalToolSchemas.scala:22` justifies its `private[protocols]` with "only
  `AssistantProtocol` (**same package**…)", which stops being true once the two land in different
  subpackages. Consistent with D9's reasoning; worth one sentence so it is a decision rather than a
  surprise at review.
- **Intermediate commits will not compile.** The seven `git mv` commits (tasks 20-26) precede the
  package/import rewrite, so no commit between them builds. Husky runs only ESLint/tsc/Prettier/schema/
  OpenSpec/Scala-quality/Jest — no `sbt compile` — so the commits will land, and the squash makes it
  moot. Fine as designed; just don't let a reviewer read D10's "keeps the branch reviewable" as
  "each commit is green".
- **No circular or unsatisfiable dependency in tasks.md.** baselines → mapping → moves → rewrite →
  READMEs → gates is a valid order, and "verify each README by `ls`-ing actual final contents" is
  correctly placed after the moves. Size is large but the mapping-driven decomposition is the right
  one; I am not refuting on size.
- **The 150-line trade is reasonable** — nine recorded decisions genuinely need the space, and flagging
  it beats hiding it. Note the sentence says "182 lines"; the file is **187**.
- **`private[services]` non-encapsulation** (117 sites) is correctly captured in Risks and in
  tasks.md:45. Good.
- **Credit where due:** D1's 70 now reproduces exactly, D3's self-retraction is honest and verified,
  HEL-802/803/804 all exist with accurate bodies, and the observation that no package object contains
  an `implicit` (which I checked independently) is what actually makes this refactor safe from silent
  implicit re-resolution.
