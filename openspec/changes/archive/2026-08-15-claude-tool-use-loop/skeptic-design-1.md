## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/claude-api-client/spec.md` in
  full from `$WORKTREE_PATH/openspec/changes/claude-tool-use-loop/`.
- Read the current state of every file the change touches:
  `backend/src/main/scala/com/helio/ai/ClaudeClient.scala`, `ClaudeModels.scala`,
  `ClaudeWireModels.scala`, `ClaudeTransport.scala`, `ClaudeProtocol.scala`,
  `HttpClaudeTransport.scala`, `ClaudeConfig.scala`, `ClaudeTokenEstimator.scala`, and the existing
  `ClaudeClientSpec.scala`.
- Read the canonical epic design spec. Note: `docs/superpowers/specs/2026-08-14-top-level-assistant-design.md`
  does **not exist in `$WORKTREE_PATH`** — `git log` shows the worktree's branch
  (`feature/claude-tool-use-loop/HEL-660`, tip `1e2e3a86`) diverged from `main` at `e77bf716`
  (HEL-401) and never picked up `main`'s later `d309b380` ("Add top-level in-app assistant design
  spec") commit, which added that file. I read the file from the main checkout
  (`/home/matt/Development/helio/docs/superpowers/specs/2026-08-14-top-level-assistant-design.md`,
  same repo) instead, since it's the canonical reference regardless of which checkout serves it.
  This is a worktree/base-branch positioning gap, not a defect in the planning artifacts
  themselves — noted, not blocking.
- Verified `openspec validate claude-tool-use-loop --strict` myself: `Change 'claude-tool-use-loop' is valid`.
- Cross-checked the ticket's scope-boundary framing (`maxHops` caller-supplied, not hardcoded in
  `ClaudeClient`) against design.md's D1–D7 and spec.md's requirements — consistent throughout
  (`ClaudeToolRequest.maxHops` has no default, unlike `maxTokens`/`temperature`; spec.md states it
  explicitly: "`maxHops` SHALL be a parameter of `ClaudeToolRequest` supplied by the caller, never a
  value hardcoded inside `ClaudeClient`").
- Traced the hop-accounting example in design.md D5 / tasks.md 4.4 / spec.md's "4th tool_use
  attempt" scenario by hand: 4 transport calls, 3 executor invocations, no 5th transport call →
  internally consistent across all three documents.
- Checked for naming collisions on every new type (`ClaudeContentBlock`, `ClaudeToolMessage`,
  `ClaudeTool`, `ClaudeToolRequest`, `ClaudeToolExecutor`, `ClaudeToolOutcome`,
  `ClaudeApiTool`/`ClaudeApiToolMessage`/`ClaudeApiToolRequest`) via `grep -rn` across
  `backend/src` — none exist today; all are genuinely additive.
- Checked every existing construction site of `ClaudeApiContentBlock` (`grep -rn
  "ClaudeApiContentBlock("`) — all 7 use exactly the 2 current args (positional or named), so
  appending new optional fields with `None` defaults (D2) is safe as planned.
- **Checked every implementer of the `ClaudeTransport` trait** (`grep -rl "extends
  ClaudeTransport"`) — this is where I found the blocking issue below.

### Verdict: REFUTE

### Change Requests

1. **`design.md`'s D4/Risks section materially misstates the blast radius of adding `sendTool` to
   `ClaudeTransport`, and `tasks.md` doesn't cover it.** `ClaudeTransport` is a bare trait with no
   default method bodies (`ClaudeTransport.scala:12-15`). Grep shows **7 classes implement it**,
   not the 2 the plan accounts for:
   - `HttpClaudeTransport` (main) — covered, task 3.2.
   - `ClaudeClientSpec`'s `FakeClaudeTransport` (`backend/src/test/scala/com/helio/ai/`) —
     covered, task 4.1 ("extend ... or add a parallel fake").
   - `AuthoringTelemetrySpec.scala:152`, `DashboardAuthoringRoutesSpec.scala:133`,
     `RefinementRoutesSpec.scala:139`, `DashboardAuthoringServiceSpec.scala:185-188`,
     `RefinementServiceSpec.scala:180` — **5 more `FakeClaudeTransport` classes, in
     `com.helio.api.routes` and `com.helio.services`, each `extends ClaudeTransport` implementing
     only `send`/`stream`. None are mentioned anywhere in `tasks.md`.**

   Design.md's own Risks section claims: *"`ClaudeTransport` SPI grows a third method → existing
   `HttpClaudeTransport`/fakes must implement it; contained to this one file plus test fakes, no
   ripple into unrelated callers (**no caller of `ClaudeClient` exists yet outside this
   package**)."* That parenthetical is factually false — `ApiRoutes.scala:12` imports and
   constructs `ClaudeClient` in `com.helio.api`, and the 5 specs above construct it with their own
   `ClaudeTransport` fakes in two other packages. Adding `sendTool` as an abstract trait member (as
   task 3.1 specifies, with no default) will fail to compile all 5 of those spec files as soon as
   task 3.1 lands — a build break in files nobody on the task list touches, discovered mid-execution
   rather than planned for.

   **Required revision** — pick one and reflect it in both `design.md` and `tasks.md`:
   - (a, preferred, consistent with D1–D3's own stated "additive, minimal blast radius"
     philosophy): give `sendTool` a default trait-level implementation (e.g. throw
     `UnsupportedOperationException`, mirroring the existing "outbound-only" pattern already used
     for `claudeApiRequestFormat.read` in `ClaudeProtocol.scala:24-25`) so the 5 unrelated fakes
     keep compiling untouched, since none of them ever exercise `sendTool`; or
   - (b): add explicit tasks to override `sendTool` in all 5 fakes, and update `proposal.md`'s
     Impact section (see #2) to list every touched file.

2. **`proposal.md`'s Impact section is inconsistent with `design.md`/`tasks.md`.** It lists only
   `ClaudeClient`, `ClaudeModels`, `ClaudeWireModels`, `ClaudeProtocol` as touched files — but D4
   and tasks 3.1/3.2 clearly plan to modify `ClaudeTransport.scala` (new `sendTool` trait member)
   and `HttpClaudeTransport.scala` (new `sendTool` implementation), and #1 above means the true
   touched-file set is larger still. Update the Impact section to name every file tasks.md actually
   plans to change, including whichever of `ClaudeTransport.scala` / the 5 spec files option (a) or
   (b) above implies.

### Non-blocking notes

- The `docs/superpowers/specs/2026-08-14-top-level-assistant-design.md` reference is unreachable
  from this worktree's checked-out branch (see above) — likely resolves itself on the next rebase
  onto `main`, but flagging in case the branch base needs to be refreshed before HEL-661+ land on
  top of this one and hit the same gap.
- D6's "reuse `guardrailReject`, approximating block content as flattened text for the estimate" is
  a little underspecified mechanically — `ClaudeTokenEstimator.estimate` takes `Seq[ClaudeMessage]`
  (`content: String`), not `Seq[ClaudeToolMessage]` (`content: Seq[ClaudeContentBlock]`), so
  `guardrailReject` itself can't be called as-is against tool-loop history without either a small
  flattening helper or a new estimator overload. Not blocking — the intent is clear enough for a
  competent implementer — but worth a one-line callout in design.md so the task isn't rediscovered
  as a surprise.
