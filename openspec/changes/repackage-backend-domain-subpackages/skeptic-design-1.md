# Skeptic Report — design gate (round 1, skeptic-design-1.md)

Worktree: `/home/matt/Development/helio/.claude/worktrees/task/repackage-backend-domain-subpackages/HEL-633`
Base: `29fc0528`. All commands run inside the worktree.

## What I verified (with evidence)

Every number below is from my own command run in this worktree, not from the artifacts.

**Tree shape.** `find . -type d | while read d; do find "$d" -maxdepth 1 -name '*.scala' | wc -l; done` under
`backend/src/main/scala/com/helio`:
`services` 88, `api/routes` 48, `api/protocols` 46, `infrastructure` **40**, `domain` root 22,
`api` root 12, `services/layout` 1, `domain/{panels,shapes,steps}` 12/9/24, `ai` 10, `app` 5,
`email` 3, `spark` 2, `security` 0. Total 322 — matches the proposal.
Movers in the five named layers = 88+48+46+40+22 = **244**, matching "~244 files moved".

**Test tree.** 218 `.scala` files; 143 match `^import com\.helio\.(api|services|infrastructure|domain)`.
Both figures confirmed.

**Quality baseline.** `node scripts/check-scala-quality.mjs` → `clean (128 soft warning(s))`; independent
`grep -c 'soft budget'` also 128. Confirmed exactly.

**Protocol mixin claim (D7.2).** `api/JsonProtocols.scala:75-113` is
`trait JsonProtocols extends ResourceProtocol with … ` — 39 direct mixins; 41 `*Protocol` traits exist
under `api/protocols/`, the remaining two (`PipelineStepProtocol`, `PipelineAnalyzeProtocol`) arrive
transitively. Formats are `implicit val`s inside those traits and reach call sites by inheritance
(`object ServiceResponse extends JsonProtocols`, `api/routes/ServiceResponse.scala:25`). **The planner's
claim is correct**: spray-json format resolution here is inheritance-scoped, not package-scoped, so a
package move cannot silently re-resolve a format. Credit where due — this was the riskiest claim in the
document and it holds.

**`com.helio.api.protocols._` wildcard.** 2 main files, 10 test files. Confirmed exactly as stated.

**D3 evidence.** `grep -rl 'DashboardProposalService' --include='*.scala'` → **24 files exactly**. The
number is real. See CR-7 for the one file the design misnames.

**Config / reflection surface.** `grep -rn 'com\.helio' backend/src/main/resources/` → empty;
`backend/src/test/resources/` → empty; no `META-INF/services` anywhere under `backend/`; no `com.helio`
reference in `.github/`. The design's "no `application.conf` / `logback.xml` / Flyway reference"
verification **holds**. `logback.xml` has only `<root>` elements, no `<logger name="com.helio…">`.

**Package objects, access qualifiers, import shapes** — see the change requests; these are where the
plan breaks.

---

## Verdict: REFUTE

The domain taxonomy (D1–D4) is sound and well argued, the escalation was handled correctly, and the
implicit-resolution premise is verifiably true. But the plan has two unmentioned load-bearing package
objects, a predictable compile break it does not anticipate, a mapping that is incomplete by
construction, and a verification standard (D7) that cannot detect the failure mode it exists to detect.
These are cheap to fix now and expensive to discover mid-execution.

---

## Change Requests

### CR-1 (blocking) — `domain/package.scala` must be pinned to `domain/` root; the ticket's layout would destroy it

`backend/src/main/scala/com/helio/domain/package.scala` is not an ordinary file. It is
`package com.helio; package object domain { … }`, re-exporting ~24 step types
(`type RenameStep = steps.RenameStep`, `val RenameStep = steps.RenameStep`, …) with an explicit header
saying it exists "so the wildcard `import com.helio.domain._` continues to resolve every step / config
type".

The ticket's target layout lists `package.scala` inside `domain/model/`. No artifact overrides that —
unlike D3, which explicitly overrides a ticket line. `import com.helio.domain._` appears in **68 main +
73 test = 141 files** (164 occurrences). If the executor follows the ticket, the outcomes are:
renaming it to `package object model` (breaks all 141 sites and silently changes what
`com.helio.domain._` means), or keeping `package object domain` in a file at `domain/model/` (compiles,
but the path now lies about the package — the exact defect this epic exists to remove).

Required: design.md states that `domain/package.scala` **stays at `domain/` root**, with the reason, and
proposal.md's shared-files acceptance criterion names it distinctly from `api/package.scala` (it
currently lists a bare `package.scala` in an api-only context).

### CR-2 (blocking) — `api/package.scala`'s ~200 relative aliases are invisible to a mapping-driven import rewrite

`backend/src/main/scala/com/helio/api/package.scala` is `package object api` containing roughly 200
alias pairs of the form:

```scala
  type DashboardResponse = protocols.DashboardResponse
  val DashboardResponse: protocols.DashboardResponse.type = protocols.DashboardResponse
```

Every right-hand side is a **relative** `protocols.X` reference. Splitting `api/protocols/` into
`api/protocols/<domain>/` invalidates all of them (`protocols.dashboards.DashboardResponse`, etc.).
These are neither `import` lines nor `com.helio.`-prefixed FQNs, so:

- D6's "rewrite `package`/`import` lines from the mapping" does not touch them;
- `check-scala-quality.mjs`'s FQN rule does not see them (relative, and it skips `import`/`package` lines).

This is ~400 lines of hand-edit — plausibly the single largest edit in the change — and it appears
nowhere in proposal.md, design.md or tasks.md.

Also add the corollary, because it is the reason the protocols split is *cheap* and the plan never says
it: this package object is what keeps `import com.helio.api._` (30 main files, 32 occurrences) working
across the protocols move. D6 does not mention that wildcard at all.

Required: a design decision covering package-object alias rewriting, and a task for it.

### CR-3 (blocking) — `ServiceResponse.scala`'s `private[routes]` breaks on the ticket-mandated move to `api/http/`

`backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala:76`:

```scala
  private[routes] def statusCodeFor(e: ServiceError): StatusCode = e match {
```

called from `api/routes/RefinementRoutes.scala:41` and `api/routes/DashboardAuthoringRoutes.scala:50`
(both scaladoc-documented as deliberately relying on that loosened visibility). The ticket moves
`ServiceResponse` to `api/http/`. Once it is `com.helio.api.http.ServiceResponse`, `routes` is no longer
an enclosing package and this **will not compile**.

Every available fix is an access-modifier change: `private[api]` (widens visibility), `private[http]`
(breaks both callers), or abandon the move. "Moves, `package` declarations, imports, and READMEs only.
No signature changes" authorizes none of them. Pre-decide it in design.md rather than letting the
executor improvise under a red compiler.

I checked the other qualifiers and they are safe: `private[services]` (117), `private[infrastructure]`
(8), `private[protocols]` (2), `private[api]` (2), `private[domain]` (1) all keep an enclosing package
after their moves. `private[routes]` on `RefinementRoutes`/`DashboardAuthoringRoutes` is fine — those
stay under `routes/<domain>/`. `ServiceResponse` is the only casualty, and it is deterministic.

### CR-4 (blocking) — D6's "sharp edge" figures are wrong; the executor is aimed at work that does not exist

D6 states: "`com.helio.domain._` (69), `com.helio.services` (45), `com.helio.infrastructure` (39)".
Measured (`grep -rlE '^import com\.helio\.X\._'`):

| wildcard | main | test | D6 says |
|---|---|---|---|
| `com.helio.domain._` | 68 | 73 | 69 (main only; test tree omitted) |
| `com.helio.services._` | **0** | 6 | 45 |
| `com.helio.infrastructure._` | **0** | 19 | 39 |
| `com.helio.api._` | 30 | 0 | *not mentioned* |

There is **no** `services._` or `infrastructure._` wildcard anywhere in main. The 39 is the
`infrastructure/` directory file count (itself off by one — see CR-6) relabelled as a wildcard count.

The real bulk mechanical work is elsewhere and unmentioned: **185 braced multi-name imports** in main of
the form `import com.helio.domain.{A, B, C}`, each of which must fan out across several new subpackages;
and **43 indented, scope-local imports** of `com.helio.*` across main+test (e.g.
`test/scala/com/helio/api/ComputedFieldsRoutesSpec.scala:145`,
`test/scala/com/helio/api/protocols/DataSourceProtocolSpec.scala:136`) which a `^import` anchored rewrite
silently skips.

Required: correct the figures, add the `api._` wildcard, and name braced-import fan-out and indented
imports as the actual sharp edges.

### CR-5 (blocking) — D7 cannot detect a behaviour change; a strictly stronger check exists and is unused

For a pure move the invariant is **per-file content identity modulo `package`/`import` lines**. Nothing
in D7 tests it:

- **D7.1** — "enumerate every mounted path+method from `ApiRoutes.scala`" is not executable as written.
  `ApiRoutes.scala` (691 lines) composes *sub-routers* (`health.routes ~`, `concat(auth.routes,
  oauth.routes, …)` at lines 475–510); the paths and methods live in the 48 route files. The baseline
  would capture composition order only and would be blind to a `~` reorder inside, say, `PanelRoutes.scala`
  — which is precisely the load-bearing-order hazard D7.1 cites as its own motivation.
- **D7.4** — `javap` public signatures cannot see a method-*body* change: a flipped boolean, an altered
  constant, a dropped `.trim`, a reordered `~`. All of those are exactly the accidents a 244-file move
  produces, and all of them pass D7.4.
- **D7.2** — correct in premise (verified above) but near-vacuous as a check: a mixin-graph change would
  already be a compile error.
- **D7.3** — the one well-designed item. Set-not-count is the right instruction and the 128 baseline is
  real.

Required: add as the primary gate — for each rename pair,
`git show <base>:<old> | grep -v '^[[:space:]]*\(package\|import\)[[:space:]]'` must be byte-identical to
the same filter applied to the new file, with a short **enumerated** allow-list of legitimate
non-import edits (currently: the two package objects' alias bodies per CR-1/CR-2, and `ServiceResponse`'s
access qualifier per CR-3). That turns "the diff is too large to review" into "the diff is empty except
for N named exceptions", and it subsumes D7.1/D7.4.

Apply the same filter to `backend/src/test/`, which closes a second gap: proposal.md's acceptance
criterion says "test diff limited to `package`/`import` lines", but **no task in tasks.md verifies it**.
D5's `--name-status`-only-`M` check is sound and sufficient against HEL-634 absorption (it exactly
catches adds/deletes/renames), but it cannot catch a test *body* being edited in place — e.g. an
assertion quietly deleted because it broke. That is both a scope breach and a verification breach and
nothing currently detects it.

### CR-6 (blocking) — the mapping is incomplete by construction; two mover sets are outside it

tasks.md asserts the mapping covers "every file in `services/`, `api/routes/`, `api/protocols/`,
`infrastructure/`, `domain/` root" — the 244. Two sets move and are in neither the count nor the
completeness assertion:

1. **`api/` root** — 12 files, of which the ticket moves 8 to `api/http/` (`AccessCheckerImpl`,
   `AclDirective`, `AuthDirectives`, `CookieConfig`, `RequestValidation`, `ResourceType`,
   `ResourceTypeRegistry`, `TraceContextDirective`). A later task moves them, but no task asserts
   coverage of them.
2. **`services/layout/`** (1 file) — the ticket explicitly reassigns it to `panels`. It is mentioned in
   **no** planning artifact. Worse, the acceptance criterion ("no file *directly in* `services/`…") is
   satisfied whether or not it moves, so the AC structurally cannot catch the omission.

Additionally, **`api/TopLevelErrorHandlers.scala` is assigned nowhere**: the ticket's `api/http` list
omits it and its "stays put" list (`ApiRoutes`, `JsonProtocols`, `package.scala`) omits it too.
proposal.md's shared-file AC omits it as well. Pick a home explicitly.

Required: mapping covers 244 + `api/` root + `services/layout/`; the completeness assertion enumerates
those roots; `TopLevelErrorHandlers` gets an explicit assignment.

### CR-7 (blocking, cheap) — factual corrections in the design's own evidence

design.md is the declared source of truth for the mapping, so its numbers have to be right.

1. **Context: "`infrastructure/` 39"** — actual **40**. The document's own "222 movers" arithmetic only
   works at 40 (88+48+46+40), so the 39 is a typo that also propagated into D6 as a fake wildcard count.
2. **D1: "70 files matching none of them"** — the breakdown that follows sums to **64**; the actual
   count for those nine prefixes is **65** (`Metric*` is 5, not 4). Reconcile the headline with the list.
3. **D3: "only two of them (`DashboardContentsService`, `DashboardServiceValidation`) are
   dashboards-local"** — I ran the grep. 24 files, exactly as claimed, and `DashboardContentsService` is
   real. But **`DashboardServiceValidation.scala` is not among the 24 and contains no `DashboardProposal`
   reference at all** (`grep -n 'DashboardProposal' services/DashboardServiceValidation.scala` → no
   match). The D3 *decision* survives — 23 real consumers, overwhelmingly authoring / patch-set /
   assistant / proposal files, with only `DashboardContentsService`, `infrastructure/DashboardContentsOps`
   and the dashboards-side routes local — so **move `DashboardProposalService` to `proposals` as
   planned**. Just fix the sentence; a reviewer who spot-checks the named file will find it false and
   distrust the rest.
4. **"41 protocol traits mix into `JsonProtocols` via `extends`"** — precisely, 41 exist, 39 mix in
   directly, 2 (`PipelineStepProtocol`, `PipelineAnalyzeProtocol`) transitively. Minor, but D7.2's
   before/after comparison should be written against 39-direct so it does not appear to fail.

### CR-8 (blocking) — two hardcoded logger-name string literals name the old package

`services/AuthoringTelemetry.scala:33` and `services/AssistantTelemetry.scala:29` both do:

```scala
  private val log: Logger = LoggerFactory.getLogger("com.helio.services.<Name>")
```

These two files land in different subpackages (`proposals` / `assistant`). The string is not
compile-checked, and D7.4's `javap` check cannot see a string constant. Leaving it means a logger
category that no longer matches its class; changing it renames a log category, which **is** a behaviour
change under this ticket's own iron constraint.

I confirmed nothing in config keys off these names (`logback.xml` has only `<root>` elements; zero
`com.helio` matches across `backend/src/main/resources/`), so leaving them untouched is defensible — but
it must be a recorded decision, not an executor coin-flip at line 33.

### CR-9 (non-blocking if recorded, blocking if ignored) — 10 live `openspec/specs/` files will name FQNs that no longer exist

`grep -rlE 'com\.helio\.(services|infrastructure|api|domain)' openspec/specs docs` → 10 live spec files:
`acl-resource-type-registry`, `connector-registry`, `connector-secret-redaction`, `connector-spi`,
`fetch-error-envelope`, `filesystem-abstraction`, `filesystem-list-pagination`, `gcs-filesystem`,
`pipeline-shape-registry`, `schema-inference-facade`. Examples that this refactor invalidates:
`com.helio.infrastructure.FileSystem` → `…infrastructure.storage`, `com.helio.api.ResourceTypeRegistry`
→ `…api.http`, `com.helio.domain.Connector` → `…domain.connectors`.

proposal.md claims "Zero runtime, API, schema, migration, or frontend impact" and declines to touch
`openspec/specs/` because HEL-775 owns it. Deferring is a reasonable call. Silently deferring is not —
in a ticket whose stated motivation is that "a README in this repo drifted from reality and misdirected
readers." Record the drift explicitly (spinoff ticket or a named deferred-drift note), and drop the
"zero impact" phrasing, which is now false for docs.

---

## Non-blocking notes

- **`private[services]` does not create a boundary.** 117 sites keep `com.helio.services` as their
  visibility scope, so after the split a `private[services]` member in `services.dashboards` stays
  reachable from `services.pipelines`. Correct for a no-behaviour-change refactor — just make sure the
  READMEs do not imply the split produced encapsulation it did not.
- **`check-scala-quality.mjs:30`** hardcodes
  `AGGREGATOR_FILES = new Set(["backend/src/main/scala/com/helio/api/JsonProtocols.scala"])`. Under this
  plan `JsonProtocols` stays put, so the 128 baseline is safe — but if that ever changed, the file's
  budget would silently relax 80 → 250 and the set-diff in D7.3 would flag it as a *removed* warning.
  One sentence in the design would save a future confused reader.
- **D8, D9 are good.** Not assuming `git log --follow` survives the squash, and merging `origin/main`
  *before* the gates rather than at delivery, are both correct and better than what the ticket asked for.
- **D1–D4 taxonomy: no objection.** The thirteen-domain amendment is well argued, the rejected
  alternatives are the right alternatives, D2's ~51-file combined-bag reasoning is sound, and D4's
  `ChatAccess*` → `auth` correctly follows the ticket's own `PipelinePermissionService` precedent. My
  objections are all mechanical, not taxonomic.
- **Planner Notes handling of the timed-out `--await` is exactly right** — treating the timeout as *not*
  an approval and sourcing the answers from the human. Noting it so it survives into the record.
