## Skeptic Report — design gate, fold-in A re-run, round 2 (skeptic-design-foldin-a-2.md)

### What I verified (with evidence)

Cold re-derivation from the current worktree state; round 1's report
(`skeptic-design-foldin-a-1.md`) and the orchestrator's narrative treated as claims only.

**Ground truth:**
- `git status`: only `proposal.md`, `specs/nl-dashboard-proposal-authoring/spec.md`, `tasks.md`,
  `ticket.md`, `workflow-state.md` carry unstaged edits since the archived commit
  (`ce582288`). **`design.md` has zero diff** — confirmed via `git diff` producing no output for it.
- `git diff` on the four content-relevant files, read in full, plus `Read` of the complete current
  `spec.md`, `tasks.md`, `proposal.md`, `ticket.md`, `design.md`.
- `openspec validate nl-dashboard-proposal-authoring --type change --strict` run twice independently
  → `Change 'nl-dashboard-proposal-authoring' is valid` both times, exit 0 both times.

**CR1 (new `spec.md` Requirement + two Scenarios for the 502 mapping): RESOLVED.**
`specs/nl-dashboard-proposal-authoring/spec.md:95-110` adds "### Requirement: Upstream Claude
API/transport failures SHALL surface as a Bad Gateway response" with body text "The authoring
service SHALL surface a `502 Bad Gateway` response, for both the buffered and streaming variants,
when `ClaudeClient.send`/`ClaudeClient.stream` fails with `ClaudeError.ApiError` or
`ClaudeError.TransportFailure`..." plus two `#### Scenario:` blocks — "A buffered call maps an
upstream failure to 502" (author path) and "A streaming call's terminal error event reflects the
same mapping" (authorStreaming path). This is exactly the buffered+streaming pair CR1 asked for, and
its phrasing mirrors the cited `openspec/specs/rest-api-connector/spec.md:29-31` "Refresh fetch
failure returns 502" precedent (WHEN/THEN, one Scenario per code path). Confirmed the openspec
validator's actual `containsShallOrMust` check (`/usr/lib/node_modules/@fission-ai/openspec/dist/
core/validation/validator.js:369-393`) scans the requirement body text (header line is skipped by
`extractRequirementText`), and the new block's body plainly contains "SHALL" — not just its heading —
so this isn't a heading-only trick; a live `openspec validate --strict` run confirms it passes for
real, twice.

**CR2 (correct proposal.md/ticket.md's per-branch framing): RESOLVED.**
- `proposal.md:21-24` new fold-in bullet: "`GuardrailExceeded` closes a gap where `spec.md` already
  had a scenario but it went unexercised; `ApiError`/`TransportFailure` had no `spec.md` coverage at
  all (only a `design.md` Decision) — this fold-in adds that Scenario too." This is accurate
  per-branch (not a blanket "spec.md already specifies this" claim) and explicitly folds the new
  Scenario into this change's own scope, as CR2 required.
- `ticket.md:29-37` new fold-in AC: distinguishes "`GuardrailExceeded` branch closes a gap where
  `spec.md`'s own written... scenario existed but was never exercised" from "the `ApiError`/
  `TransportFailure` branches had no `spec.md` coverage at all before this fold-in (only a `design.md`
  Decision) — a new `spec.md` Scenario for the 502 mapping is added as part of this same fold-in, per
  the design-gate review that caught the gap." Same accurate per-branch framing, and correctly
  attributes the gap-finding to the design-gate review rather than re-asserting the original
  overgeneralization.

**CR3 (no new design.md Decision should be added): RESOLVED — verified by absence, not narrative.**
`git diff -- .../design.md` (as part of the four-file diff command above) produces **no output** —
the file is byte-identical to the archived commit. D8 ("Error mapping. `ClaudeError.ApiError`/
`TransportFailure` → `ServiceError.BadGateway`...") stands unchanged as the sole design-level source
for the mapping, exactly as CR3 asked for.

**CR4 (tasks.md needs a small task for the spec delta, no other content change): RESOLVED.**
`tasks.md` gained task `7.0`: "Add a `spec.md` Requirement + two Scenarios (buffered + streaming)
documenting the `ApiError`/`TransportFailure` → `502 Bad Gateway` mapping — this endpoint had no
written spec coverage for it before this fold-in (only a `design.md` D8 Decision), unlike the
`GuardrailExceeded`/422 branch which already had one." This is precisely the "one line task for the
spec delta" CR4 offered as the minimal acceptable form. Tasks 7.1-7.4 are otherwise unchanged in
substance from round 1 (still the GuardrailExceeded/ApiError+TransportFailure/streaming-mirror/
sbt-test-green sequence I already traced against real `ClaudeClient`/`DashboardAuthoringService` code
in round 1).

**Note on tasks 1.1-6.1 (out of CR scope, checked anyway):** the diff shows every already-completed
task in sections 1-6 reworded to a terser phrasing (e.g. 1.1's multi-sentence description condensed
to one clause). This predates round 2 — round 1's report already read the same `tasks.md` in full and
raised no objection, and comparing meaning rather than wording, each reworded item preserves the
same technical content as its predecessor (same method signatures, same test suites named, same
behavior-preserving claim). Since these are `[x]`-completed historical record entries, not
instructions bearing on any code not yet written, this is inert to what an implementer would do next.
Non-blocking.

**Line/word budgets:**
- `wc -w proposal.md` → 303 words (44 lines). The instruction flagged this as "303 against an
  under-300-words soft rule, not validator-enforced" and asked for my judgment: 303 is 1% over a soft,
  unenforced target, on a proposal that was simultaneously tightened elsewhere in the same edit (the
  "Impact" and "Capabilities" sections were shortened) to make room for the new, necessary fold-in
  bullet. Not a basis for REFUTE.
- `tasks.md` (61 lines) and `ticket.md` (47 lines): no stated budget for either; both stayed
  proportionate to the single new task/AC each gained.

**Stability check:** re-ran `openspec validate ... --strict` a second time after the first read-only
pass to rule out a flaky first result — identical `valid`/exit-0 output both times, so this is a
reproduced pass, not a single anomalous reading.

### Verdict: CONFIRM

All four of round 1's change requests are genuinely resolved in the current file contents, not merely
asserted by the orchestrator's narrative:
1. `spec.md` now has a dedicated Requirement with a buffered and a streaming Scenario for the
   `ApiError`/`TransportFailure` → 502 mapping, matching this repo's own `rest-api-connector`
   precedent and passing the real openspec validator's SHALL/MUST + scenario-count checks.
2. `proposal.md`/`ticket.md` now state the per-branch spec-coverage history accurately instead of
   implying uniform prior coverage.
3. `design.md` is untouched (byte-identical diff) — no redundant Decision was added; D8 remains the
   sole, sufficient design-level statement of the mapping.
4. `tasks.md` gained exactly one small task (7.0) for the spec delta; 7.1-7.4 needed no content
   change and got none.

`openspec validate nl-dashboard-proposal-authoring --type change --strict` passes, reproduced twice.
proposal.md's 303-word count is immaterially over an unenforced soft target and does not warrant a
REFUTE.

### Non-blocking notes

- `workflow-state.md`'s fold-in comment block (lines 17-21) still reads "no new design decision or
  spec delta needed — pure test-coverage addition for an already-written spec.md scenario," which
  round 1 disproved for 2 of 3 branches, and `FOLDIN_A_DESIGN_ROUND` is still recorded as `1` even
  though this is round 2. Neither field is one of the four artifacts round 1's change requests
  targeted (proposal/ticket/tasks/spec.md), and neither misleads an implementer (tasks.md/spec.md/
  proposal.md/ticket.md are the operative documents), but the orchestrator should refresh this
  tracking comment/counter on its next write to avoid the stale note reading as a re-assertion of the
  overgeneralization CR2 just fixed elsewhere.
- Tasks 1.1-6.1's cosmetic rewording (noted above) is inert but was outside the four change requests'
  scope; flagging only so it isn't mistaken for an intentional round-2 edit if anyone diffs
  fold-in-a-1 vs fold-in-a-2 file-by-file later.
