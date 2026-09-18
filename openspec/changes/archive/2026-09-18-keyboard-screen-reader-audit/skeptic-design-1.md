## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and the spec delta
  `openspec/changes/keyboard-screen-reader-audit/specs/form-panel-rendering/spec.md` in full.
- Read the existing capability spec `openspec/specs/form-panel-rendering/spec.md` in full to confirm
  the delta is additive (ADDED Requirements only) and does not contradict existing requirements
  (keyboard-completability, computed-name/description, error-association requirements already there
  are untouched; the new requirements are scoped to the *assembled* panel and grid, which is new
  ground).
- Cross-checked every AC in `ticket.md` against `tasks.md`:
  - Full keyboard-only submit against running app → tasks 1.1–1.3.
  - Tab order incl. file/counter → tasks 1.2–1.3.
  - Focus on submit/success/server-rejection → tasks 2.1–2.4.
  - Live-region announcement measured (not inferred) → tasks 3.2, 3.3.
  - Panel role/name in grid via computed tree → tasks 3.1, 3.3.
  - Re-measure HEL-1158's three findings, no duplicate ticket → tasks 4.1–4.4.
  Every AC traces to at least one task; no task is scope not covered by an AC (section 5, "fix any
  blocking defect," is explicitly gated by ticket's own instruction to fix blockers, not polish).
- Pulled HEL-1158 via `mcp__linear__get_issue`: confirmed it is still `Backlog` (unfixed) and its
  three findings (submit below fold, same-frame clear/refill re-announcement, duplicated error text)
  match exactly what `tasks.md` section 4 and `design.md` Decision 3 describe re-measuring. The
  design correctly treats this as observational re-measurement, not corrective work, and correctly
  reserves "fix" only for a finding that would newly reclassify as blocking — matching the ticket's
  non-goal ("Do not duplicate HEL-1158's three findings as new tickets — only re-measure and
  report").
- Verified `design.md`'s citation of `FormSubmission.buildRow` (Decision 2's basis for a genuine
  server-side rejection path distinct from client-blocked validation) against the real file:
  `backend/src/main/scala/com/helio/domain/panels/FormSubmission.scala:56`. Confirmed real,
  server-only rejection paths exist there that a client wouldn't necessarily pre-block (e.g.
  `FormUploadConfig.validate` file-extension/size checks, "not declared by the bound dataset"),
  so Decision 2's claim that a genuine server-side rejection is achievable is grounded, not
  hand-waved.
- Confirmed C7 (mutation-proof) and C8 (computed-state, never presence) are bound explicitly in
  `tasks.md`'s Standing Constraints section and threaded through every relevant task (1.3, 2.4, 3.1,
  3.2, 3.3), not just asserted once at the top and forgotten.
- Confirmed `e2e` non-pre-commit-gate status (HEL-1157) is acknowledged as a stated risk in
  `design.md` with an explicit mitigation (manual run + CI `e2e` job check before merge), matching
  the ticket's own constraint list.
- No `TODO`/`TBD`/deferred-decision language found anywhere in the four planning artifacts.

### Verdict: CONFIRM

### Non-blocking notes

1. `design.md` Decision 2 names the *category* of server-only rejection to trigger ("a value that
   passes client validation but fails a server-only constraint") but does not pin the exact
   mechanism (e.g. an oversized/wrong-extension file past `FormUploadConfig`, vs. a
   dataset-declaration mismatch). This is a reasonable implementation-time choice, not a blocking
   ambiguity — `FormSubmission.buildRow` gives at least one concrete, verified candidate (file
   validation) the executor can use without further design input.
2. Consider having the executor record, for HEL-1158 finding #2 (same-frame re-announcement), which
   of "still holds / changed / fixed" applies with the same frame-number-style evidence HEL-1158
   itself used (`frame 2817` vs `10130→10131`) — `tasks.md` 4.2 already implies this but doesn't say
   it explicitly; worth calling out to the executor so the re-measurement is comparably rigorous to
   the original, not just qualitative.
