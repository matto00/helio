# Skeptic Report — design gate (round 4, skeptic-design-4.md)

Worktree: `/home/matt/Development/helio/.claude/worktrees/task/repackage-backend-domain-subpackages/HEL-633`
Base: `29fc0528`. Fresh cold instance. Every figure below is from a command I ran in this worktree, or
from a program I compiled with the project's own Scala 2.13.15 compiler. Nothing is taken from
`skeptic-design-{1,2,3}.md` or from the artifacts' own assertions.

---

## What I verified (with evidence)

### D0 — I re-derived the governing fact from the compiler, not from the document

`javac`-style invocation of `scala.tools.nsc.Main` from the coursier cache
(`scala-compiler-2.13.15.jar`, `-usejavacp`). Four sources, one shared `A.scala` defining
`com.helio.api.routes.ServiceResponse` with both a public `hello` and a `private[routes] statusCodeFor`:

| Row | Form | Result I observed |
|---|---|---|
| 1 | `package com.helio.api.routes.dashboards` (single clause), no import | `r1/B.scala:2: error: not found: value ServiceResponse` — exit 1 |
| 2 | `package com.helio.api.routes` ⏎ `package dashboards` (nested), no import | exit 0 |
| 3 | single clause **+** `import com.helio.api.routes.ServiceResponse` | exit 0 |
| 4 | single clause + import, calling `private[routes] statusCodeFor(200)` | exit 0 |

**D0's table reproduces exactly, all four rows.** Its second claim also holds:

```
find backend/src -name '*.scala' | wc -l                      → 540
files with >1 plain `^package <fqn>` clause                    → 0
```

So every one of the 540 files is single-clause, and both consequences D0 draws (every moved file needs
new imports for names left behind; converting to nested clauses is forbidden) follow from a fact I
confirmed myself. **D0 is correct.**

### D0's propagation — I looked for residual traces of the old false premise and found none

`grep -nE 'no import|still resolve|stays enclosing|enclosing|without an import|supplied by'` across
`ticket.md proposal.md design.md tasks.md` returns 7 hits. All 7 are either D0 itself, D0's own
consequence text, the **true** `private[routes]` half (design.md:85, which I verified as row 4 above), or
D4's "same-package construction" phrasing (correct). The two places round 3 found the false premise are
both explicitly retracted in-place and labelled as earlier drafts (design.md:82-87 for D3; design.md:189+
for D7b's hedge, now replaced with the correct over-count reason). `proposal.md` carries D0 forward
verbatim in its "Insert roughly 675 new import lines" bullet. **Propagation is complete.**

### Part A — round 3's eight change requests, checked against ground truth

| CR | My measurement | Verdict |
|---|---|---|
| CR-1 D0 added, D3 corrected, premise propagated | compile table reproduces 4/4; 540/540 single-clause; zero residual false claims (greps above) | **Fixed** |
| CR-2 insertion table vs D3 reconciled; shared files named | `ServiceError` referenced by **50** of 88 `services/*.scala`, only **3** import anything from `com.helio.services` (`AutoLayoutService`, `DashboardService`, `PanelService`) — exactly D7b's figures. `PaginationProtocol.scala` names exactly **5** moving traits in its `extends`/`with` clause (`DashboardProtocol, DataTypeProtocol, DataSourceProtocol, PanelProtocol, MetricProtocol`) — D7b's "5" is right and round 3's "11" was loose. `api/routes` 39/39 kept; D3's contradicting claim withdrawn | **Fixed** |
| CR-3 zero-import test surface is 35 | Reproduced independently: 218 test files, 144 with any `com.helio` import → **74** with none; of those, breaking on same-package resolution = **35**, split `domain 16 / services 6 / infrastructure 5 / api/protocols 4 / api/routes 1 / api 3` — **identical to D4**. (My first pass said 41; six were false positives from `JdbcBackend.Database` and a scaladoc block comment. Re-run after stripping those reproduces 35.) Mixin case named in D4 and tasks.md | **Fixed, and the number is exactly right** |
| CR-4 ticket.md stale `infrastructure/ 39` | `ticket.md` now says **40**; ground truth `find infrastructure -maxdepth 1 -name '*.scala' \| wc -l` → **40**; 88+48+46+40+22 = **244**, +12 +1 = **257**, tree = **322** — all four artifacts agree | **Fixed** |
| CR-5 `api.routes._` census + task | `grep -rlE '^\s*import com\.helio\.api\.routes\._'` → **1 main / 1 test**; the main one is `api/ApiRoutes.scala:12` (verified by `sed -n '12p'`). D7(a) carries the row; tasks.md carries "fan out … (line 12) across the 13 route subpackages" | **Fixed** |
| CR-6 thirteen domains enumerated | `ticket.md` has a dedicated "The thirteen domain names" section; `design.md` Context repeats all 13 | **Fixed** |
| CR-7 D6 iteration domain = union | D6 states the union explicitly and gives the reason (added file at an unmapped path / deleted stay-put file must fail, not be skipped); tasks.md baseline task records it | **Fixed** |
| CR-8 per-layer sequencing + README budget | D10 + tasks.md restructured to `move → rewrite → compile green → commit`; a dedicated README section with the ~50 figure now exists | **Partially fixed — see NB-1** |

### Part B — every new/changed number, re-measured

All of the following reproduce **exactly** in this worktree:

- Layer census `88 / 48 / 46 / 40 / 22`, `api/` root **12**, `services/layout` **1**, tree **322**.
- Test tree **218**; `^import com.helio.(api|services|infrastructure|domain)` → **143**; zero-`com.helio` → **74**; breaking subset → **35**.
- `api/package.scala`: **381** lines, **156** `type`, **155** `val`, **466** `protocols.` occurrences across **312** lines, **zero** non-`protocols.` alias targets, **zero** imports, **zero** `implicit`.
- `domain/package.scala`: **51** `type` aliases, **all** targets `= steps.` (so "content untouched" holds), **zero** `implicit`.
- `domain/panels/package.scala`: `package com.helio.domain` + `package object panels`, only import `spray.json._`, references `DataTypeId`/`MetricId`, holds the only two `implicit val`s in any package object. Exactly **3** package objects exist in `backend/src`.
- Wildcards (main | test): `domain._` **68 | 73**, `api._` **30 | 0**, `api.routes._` **1 | 1**, `services._` **0 | 6**, `infrastructure._` **0 | 19**, `api.protocols._` **2 | 10** (the 2 main are `api/JsonProtocols.scala:3` and `api/routes/AssistantConversationRoutes.scala:10`).
- Braced imports: **240 | 216** opening lines; **41 | 18** multi-line; **199 | 195** with a comma on the opening line; indented scope-local `com.helio` imports **0 main / 43 test lines** (in 5 test files).
- `ServiceResponse`: **41** `api/routes/*.scala` files match, **0** import it (**40** excluding the definer — see NB-6).
- `DbContext`: **31** main files, **120** main+test — D3's revised wording is right.
- `model.scala` **989** lines. `ApiRoutes.scala` **691** by `wc -l` (see NB-6). `ApiRoutes.scala` explicit lists: **44** services names, **30** infrastructure names.
- `JsonProtocols.scala`: **39** direct `extends`/`with` mixins.
- Quality gate: `node scripts/check-scala-quality.mjs` → `Scala code-quality check: clean (128 soft warning(s))`, **exit 0**. `AGGREGATOR_FILES` pinned to `backend/src/main/scala/com/helio/api/JsonProtocols.scala` (stays put); `FQN_PREFIXES` contains `com.helio.`; the FQN rule skips `^(import|package)` lines. Of the three `package.scala` basenames only `api/package.scala` is in the warned set (`domain/package.scala` 115, `domain/panels/package.scala` 33) — D6's basename key is unambiguous, as claimed.
- Zero `com.helio` in `backend/src/{main,test}/resources`, `.github`, or any `META-INF/services`; **10** files under `openspec/specs` match `com.helio.(services|infrastructure|api|domain)` (D11).
- D9: `AssistantTelemetry.scala:29` and `AuthoringTelemetry.scala:33` are the **only** two `getLogger("com.helio…")` literals in main; `logback.xml` has **0** `<logger>` elements. D9's line numbers are exact.
- `openspec validate repackage-backend-domain-subpackages` → `✗ [ERROR] file: Change must have at least one delta` — exactly the message `proposal.md` pre-empts. `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`, exit 0.

**Insertion surface, third independent count.** I wrote my own measurement (distinct `(file, name)` pairs;
block comments, line comments and string literals stripped; already-imported names excluded):

| layer | plan | mine |
|---|---|---|
| `services/` | 58 / 367 | 57 / 175 |
| `api/routes/` | 39 / 39 | **39 / 39** |
| `api/protocols/` | 18 / 92 | **18 / 91** |
| `infrastructure/` | 34 / 82 | 35 / 63 |
| `domain/` root | 16 / 95 | **16 / 64** |
| **total** | **~165 / ~675** | **165 / 432** |

The **file** count lands on 165 — the plan's figure, to the unit, from a third independent method; every
per-layer file count is within ±1. The **site** count is a third distinct value (675 / 507 / 432),
confirming the plan's own conclusion. D7(b) and D4 now say the compiler, not the estimate, is the
authority, and D6 does not depend on any of these numbers. **That is an adequate response**: the quantity
that determines how many files must be edited is corroborated, and the quantity that isn't is explicitly
demoted to a budgeting aid with a stated gate that does not consume it.

### Checks I ran that the plan does not claim (adversarial sweep)

- **Qualified-private breakage.** Every `private[X]`/`protected[X]` qualifier in main:
  `private[services]` 117, `private[infrastructure]` 8, `private[spark]` 4, `private[routes]` 4,
  `private[ai]` 4, `private[protocols]` 2, `private[email]` 2, `private[api]` 2, `private[steps]` 1,
  `private[domain]` 1. **Every qualifier names a package that stays enclosing after the move** (or sits
  in a non-moving package). Combined with D0 row 4, which I compile-verified, there is **no**
  access-qualifier breakage anywhere in the change. Clean.
- **Silent implicit re-resolution.** Confirmed structurally, not just by grep: implicits can only be
  package-scoped via a package object; there are exactly 3 package objects; two carry zero `implicit`,
  and the third (`domain/panels`) is reached by explicit wildcard import. D6's premise holds.
- **`api/package.scala` cannot silently mis-alias.** Every one of the 466 targets is `protocols.X` with
  `X` unique across a single flat package today, so a wrong-domain rewrite is a `not found`, never a
  wrong-but-compiling alias. The allow-list hole is narrower than it looks (but see NB-2).
- **Placement residue.** Bucketing `services/*.scala` against the 13 domain names leaves only
  `AccessChecker`, `ConnectionTest`, `ImageUploadService`, `PdfTextSupport`, `SchemaInferenceFacade`
  (all covered by HEL-633's placement notes), `ServiceError` (stays), and `DataTypeService` (genuinely
  unassigned — NB-4). One ambiguous file in 88 is acceptable.
- **Per-layer feasibility.** There is no circular constraint anywhere: moving a layer changes only its
  own files' packages, and consumers' imports can be corrected in place whether or not the consumer has
  moved yet. So a per-layer green is always *reachable*. See NB-1 for the wording that obscures this.

---

## Verdict: REFUTE

One blocking defect, and it is in the plan's own safety net rather than in its estimates.

Rounds 1–3 each found a headline count that excluded the harder instances of its class. **Round 4 does
not.** I re-measured every number in the document and the ones that matter land dead-on — 35 test files
with the exact per-layer split, `ServiceError` 50/3, `PaginationProtocol`'s 5, `api.routes._` 1|1,
466/381/156/155/312, 240|216, 41|18, 43, 989, 44/30, 128 — and where a figure is soft (the ~675 sites) the
document now says so and names the compiler as authority, which my third independent count (432) confirms
is the right posture. D0 is correct, compile-reproduced, and completely propagated. The estimate problem
is closed.

What is not closed is **D6's filter**. D6 is designated the primary gate and is the source of the
"provably identical behaviour" goal; the orchestrator's own framing names it, with the compiler, as the
safety net that catches residual imprecision. As literally specified it is line-oriented, and the change
is full of multi-line import statements the plan itself enumerated (41 main / 18 test). The gate will
therefore report dozens of differences on files that are perfectly correct — and neither the compiler nor
D6 can catch this, because it is D6. Left as written, the most likely executor response is to loosen the
filter mid-execution, and a sloppy loosening blinds the gate to exactly the body edits it exists to
catch. That is an unreviewable result, so it is blocking. It is also a one-sentence fix, and the plan
already states the correct principle one decision away (D7a: "statement-oriented, not line-oriented").

---

## Change Requests

### CR-1 (a) — **blocking** — D6's content-identity filter is line-oriented and will fail on every multi-line braced import

`design.md` D6: *"each filtered through `grep -vE '^[[:space:]]*(package|import)[[:space:]]'`, must be
byte-identical"*, with an allow-list of *"exactly one file"*.

That regex strips only the line that **begins** with `import`. The continuation lines of a multi-line
braced import survive it. Reproduced on `backend/src/main/scala/com/helio/domain/steps/JoinStep.scala`
(the file D7a itself cites):

```
$ sed -n '1,12p' domain/steps/JoinStep.scala | grep -vE '^[[:space:]]*(package|import)[[:space:]]' | cat -A
$
  DataSourceId,$
  PipelineExecutionContext,$
  PipelineId,$
  PipelineRowJson,$
  PipelineStep,$
  PipelineStepId$
}$
```

Those seven lines are compared as **content**. `JoinStep.scala` is a non-mover compared same→same, and
its import must fan out (`DataSourceId`/`PipelineStep` → `domain/model`, `PipelineRowJson` → `domain/engine`),
so its continuation lines necessarily change → D6 reports a difference on a file that is not on the
allow-list → the change fails its own primary gate for a correct edit.

Population, measured: multi-line braced `com.helio` imports drawn from a **splitting** package are
**39 main + 17 test** (`api.protocols.` 20|6, `domain.` 14|1, `infrastructure.` 5|8, `services.` 0|1,
`api.` 0|1; the 2|1 from `domain.steps.` do not split). Worst concrete case —
`services/AssistantToolExecutor.scala` imports 15 protocol names in one multi-line statement spanning at
least `assistant`, `proposals`, `panels`, `patchsets`, `sources` and `workspace`, so all 15 continuation
lines plus the `}` change.

Required:
1. Specify the D6 filter as **statement-oriented**: join multi-line `import` statements (or strip from an
   `import` line through its matching `}`) on **both** sides before comparing — the same rule D7(a)
   already mandates for the rewrite. A worked one-liner in the design would remove all ambiguity.
2. State that the filter must be fixed **in the design**, not improvised by the executor when the gate
   first fires, and that loosening it in any way that drops non-import lines is forbidden — that is the
   one edit that would silently disarm the change's central verification.
3. Re-check the allow-list sentence against the corrected filter: with a statement-oriented filter,
   "exactly one file may differ (`api/package.scala`) plus added READMEs" becomes true; today it is not.

---

## Non-blocking notes (all category (b) — the compiler or D6 catches these, but fixing them in the same pass is nearly free)

**NB-1 — the "cross-cutting rewrites" section is sequenced after the layer loop that requires it.**
This is round 3's CR-8 fix landing 90% of the way. The layer order itself is sound — I checked for
circular constraints and there are none, so a per-layer green is always reachable. But four items
tasks.md places *after* the loop are **preconditions** of steps inside it:

| item (tasks.md "cross-cutting" / later) | required by |
|---|---|
| `domain/panels/package.scala` import (listed 3rd, after `infrastructure/`) | the **1st** step (`domain/` root) — `sbt compile` cannot go green without it |
| `api/package.scala`'s 466 alias targets | the `api/protocols/` step |
| `ApiRoutes.scala` line-12 fan-out | the `api/routes/` step |
| `api/JsonProtocols.scala`'s `import com.helio.api.protocols._` (**untasked entirely**, see NB-3) | the `api/protocols/` step |

Also, the loop header reads *"rewrite that layer's `package` lines, fan out **its** imports"*, which scopes
the rewrite to the moving layer's own files. Under that reading **no** layer can reach green, because every
layer has out-of-layer consumers (e.g. moving `domain/` root breaks the 68 main files that do
`import com.helio.domain._`). I classify this (b) rather than (a) only because the step's terminal
condition — *"get `sbt compile` green"* — is objectively checkable and makes the tree-wide fix
unavoidable; an executor cannot satisfy it while touching one layer. **Fix:** reword to "rewrite every
import in `backend/src` that names a symbol this layer moved, wherever it lives", and move the four
prerequisite items into the layer steps that need them. *(If the orchestrator prefers to honour its
pre-designation and treat this as blocking, the fix belongs in the same revision as CR-1 either way, so
the classification costs nothing.)*

**NB-2 — nothing verifies the one allow-listed file.** `api/package.scala` is the single hole in
"provably identical", and it is 381 lines. Close it exactly for one line of effort: after the rewrite,
`sed -E 's/protocols\.[a-z]+\./protocols./g'` on the new file must be byte-identical to the base file.
That converts the allow-list entry from "unchecked" to "checked", and it is the only file where a body
change could hide.

**NB-3 — `api/JsonProtocols.scala` is a fourth non-mover that must be edited, and D8 lists three.**
`JsonProtocols.scala:3` is `import com.helio.api.protocols._`, and it is how all **39** direct `with
XProtocol` mixins resolve. When `api/protocols/` splits, that wildcard yields only the three stay-put
files and the file fails with 39 `not found: type` errors. D8's "Three non-movers must still be edited"
should be four. (Also: no task line covers the general wildcard fan-out at all — `domain._` alone is
**141** files, the single largest rewrite in the change. D7(a) censuses it; tasks.md never tasks it.)

**NB-4 — `services/DataTypeService.scala` has no assigned domain.** It matches none of the 13 names and
appears in neither HEL-633's placement notes nor D3. `pipelines` or `sources` are both defensible; pick
one so it is not decided by coin-flip mid-execution.

**NB-5 — D6's supporting quality-set check will very likely report a false failure.** Warned files are
those over a 250-line soft budget (`loc = wc -l + 1` in the script), and this change only ever *adds*
lines to files. Two concrete candidates:
- `infrastructure/DashboardRepository.scala` — script-loc **244**, needs ≥6 new same-layer imports
  (`DashboardContentsOps, DashboardSnapshotOps, DbContext, PanelRepository, PanelRowMapper,
  ResourcePermissionRepository`) plus the split of `import com.helio.api.protocols.{DashboardProtocol,
  PanelProtocol}` → **≥251**.
- `infrastructure/MetricRepository.scala` — script-loc **247**, needs 3 (`DashboardRepository`,
  `DbContext`, `PanelRepository`, landing in three different targets) → **250**, one line from crossing.

Every remedy for this is forbidden elsewhere in the plan (splitting the file — Non-goals; inlining an
FQN — D7b). State up front that a warned-set delta consisting **solely** of files crossing 250 by added
`import` lines is expected, must be recorded with the line arithmetic, and must **not** be "fixed".

**NB-6 — small arithmetic nits, all one-word.** (i) `ServiceResponse` is referenced by 41 `api/routes/`
files *including its own definition*, so **40** files need the new import, not 41 — D3 says 41, D7b's row
says 39; both are hedged, but the three numbers should agree. (ii) `ApiRoutes.scala` is **691** lines by
`wc -l` (the quality script's 692 counts the trailing newline); proposal.md and D6 say 692. (iii)
tasks.md's *"`api/` root: 9 directives + `TopLevelErrorHandlers`"* is 10 files, but only **9** files move
(`AccessCheckerImpl, AclDirective, AuthDirectives, CookieConfig, RequestValidation, ResourceType,
ResourceTypeRegistry, TraceContextDirective, TopLevelErrorHandlers`) — 12 at root minus the 3 that stay.
D5's "10 **names**" is right (one of the 9 files declares two top-level names); it is the task line that
is off.

**NB-7 — tasks.md's mapping assertion is false for ~8 legitimate targets.** *"Assert every target is one
of the 13 domains named in design.md Context, or a named shared/root file"* — but `domain/{model,
connectors,engine,util}`, `infrastructure/{storage,crypto,concurrency}` and `api/http` are none of those.
Widen the assertion to "one of the 13 domains, one of the named structural directories, or a named
shared/root file", or it fails on correct output.

**NB-8 — `sbt compile` per layer does not compile tests.** D10 says each layer is "move → rewrite (main +
test) → `sbt compile` green", but `sbt compile` cannot verify the test half; test breakage accumulates
silently until the final `sbt test`. `sbt Test/compile` costs little more and makes each per-layer commit
actually mean what D10 says it means.

**NB-9 — ticket.md drops HEL-633's target layout and placement notes.** design.md leans on them as the
tie-breaker in three places ("HEL-633's layout wins", "per HEL-633's own precedent sending
`PipelinePermissionService` to `auth`", "overriding HEL-633's `api/http/` line"), but that text exists
nowhere in the change directory — the local `ticket.md` is a rewritten summary. Paste HEL-633's "Target
layout" block and "Placement notes for the ambiguous files" list into `ticket.md` verbatim so the
authority the design defers to is actually present where the executor works.

**Credit.** D0 is the strongest thing in this document: a compile-verified governing fact, its two
consequences drawn correctly, the earlier error named rather than quietly patched, and the decision it
undermined kept on the half of the rationale that survives. D4's 35 reproduces to the file. The
`PaginationProtocol` "5" is more accurate than the review that asked for it. The qualified-private
surface, which nothing in the plan claims to have checked, turns out to be completely clean. And
demoting the site estimate to a budgeting aid while naming the compiler as authority is the right
answer to the one criticism that recurred through all three prior rounds — I consider that thread closed.
