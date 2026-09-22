## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Current file location/package** matches the plan's stated premise:
  `backend/src/main/scala/com/helio/api/routes/workspace/HealthRoutes.scala:1` declares
  `package com.helio.api.routes.workspace` (`grep -n "^package"` on the live file).
- **Sole external reference site**: `grep -rn "HealthRoutes" backend/src` returns exactly two
  hits outside the file's own declaration: `ApiRoutes.scala:235`
  (`private val health = new HealthRoutes()`) and the two workspace-README prose mentions. No
  other production or test file references the class.
- **No root-level wildcard import exists today**: `grep -n "^import com.helio.api.routes"
  backend/src/main/scala/com/helio/api/ApiRoutes.scala` shows 13 sub-package wildcard imports
  (`agents._`, `alerts._`, ... `workspace._`) and no bare `com.helio.api.routes._`. Confirms
  design.md D2's premise and that adding `import com.helio.api.routes.HealthRoutes` is a genuinely
  new, additive line, not a duplicate/redundant one.
- **No test imports the class/package directly**: `grep -rn "import.*HealthRoutes\|routes\.workspace\.HealthRoutes\|api\.routes\.HealthRoutes" backend/src/test`
  returns nothing. `grep -rln "/health" backend/src/test` finds only
  `ApiRoutesSpec.scala` and `ApiRoutesCorsErrorHandlingSpec.scala`, both of which the plan says
  (and I did not find contradicted) reference the endpoint only via the HTTP path string. tasks.md
  2.1 correctly targets these two specs by name for the "unchanged" verification.
- **`ServiceResponse.scala` root exception**: confirmed it is the only other file at
  `backend/src/main/scala/com/helio/api/routes/` root today (`find ... -maxdepth 1 -type f`), and
  its README rationale (qualified-private access from three cross-domain callers) is present at
  `api/routes/README.md`.
- **`git mv` + package + import + README-only scope**: tasks 1.1–1.3 correctly implement the pure
  relocation (rename detection check, package-line grep check, `sbt compile` check). No logic or
  signature change is proposed anywhere in design.md/tasks.md, consistent with HEL-632's iron
  constraint.
- **Verification steps (tasks.md §2)**: `sbt compile` (task 1.3) then full `sbt test` (task 2.1),
  naming the two specs whose `/health` behavior must stay green, is sufficient for a
  zero-behavior-change relocation. `git status` rename check (task 1.1) is the correct signal that
  history was preserved via `git mv` rather than add+delete.

### Verdict: REFUTE

### Change Requests

1. **`api/routes/README.md`'s pre-existing "counter-invariant" sentence is not scheduled for
   correction, and will become false / self-contradictory once the move lands.** The current text
   at `backend/src/main/scala/com/helio/api/routes/README.md:12` reads: "No other file lives
   directly in `api/routes/` — every route class belongs under one of the 13 domain
   subdirectories." This sentence is true today only because `ServiceResponse.scala` is a helper,
   not a route class — so "every route class belongs under one of the 13 domain subdirectories"
   still holds. Once `HealthRoutes.scala` moves to root, that clause becomes literally false:
   `HealthRoutes` **is** a route class (constructed as `new HealthRoutes()` and mounted as
   `health.routes ~` at `ApiRoutes.scala:702`), and it will no longer belong under any of the 13
   domain subdirectories. This is exactly the "counter-invariant" ticket.md's own dissent section
   names as the case *against* the move ("`api/routes/README.md` carries a counter-invariant about
   what lives at root") — the owner's ruling requires the README to "agree with the new placement,"
   which means resolving this specific sentence, not merely appending a new bullet about
   `HealthRoutes`.

   Neither design.md's D3 nor tasks.md's 1.4 names this sentence as an edit target. D3 says only:
   "add `HealthRoutes` as a second bullet in the same style, then update `workspace/README.md`'s
   'Holds' list ... and adjust its explanatory sentence" — the "adjust its explanatory sentence"
   instruction is explicitly scoped to the *workspace* README only, leaving the root README's
   contradictory "No other file lives directly... every route class belongs under one of the 13
   domain subdirectories" sentence unaddressed. Task 1.4 mirrors this same gap: "list `HealthRoutes`
   as a second named-shared-file exception at root ... with rationale" does not instruct the
   implementer to also correct the pre-existing summary sentence that would otherwise sit directly
   beneath the new bullet, contradicting it.

   **Required revision**: amend design.md D3 and tasks.md task 1.4 to explicitly require rewriting
   `backend/src/main/scala/com/helio/api/routes/README.md:12`'s summary sentence (e.g., to
   something like "Two files live directly in `api/routes/`: `ServiceResponse.scala` (a shared
   helper) and `HealthRoutes.scala` (a route class, exceptionally placed here — see above). Every
   other route class belongs under one of the 13 domain subdirectories.") so the README does not
   ship self-contradictory once `HealthRoutes.scala` sits at root as a visible counter-example to
   its own stated invariant.

### Non-blocking notes

- Ticket.md's AC phrase "the named-shared-files list that `api/routes/README.md` carries" is
  loose — the README today is prose, not a formatted list. Not blocking; design.md D3's "second
  bullet in the same style" resolves the formatting question either way, but the implementer
  should treat "list" as descriptive, not a literal bullet-list requirement.
- Proposal.md's rationale ("mirroring `HealthResponse`'s existing root placement in
  `api/protocols/`") is slightly imprecise — `HealthResponse` is a case class defined inside
  `ResourceProtocol.scala` at that root, not its own file — but this is background rationale from
  the owner's own ruling (not re-litigable) and has no bearing on the correctness of the
  implementation tasks.
