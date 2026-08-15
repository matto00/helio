## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas
  (`specs/chat-message-rendering/spec.md`, `specs/chat-quick-launcher/spec.md`), and both prior
  skeptic reports (`skeptic-design-1.md`, `skeptic-design-2.md`) in full, treating the prior reports
  as claims to re-verify, not fact.
- **Re-verified the round-2 required fix directly against the live file text** (not the round-2
  paraphrase): `tasks.md:22-28` (task 2.2) now reads, verbatim: *"`kind === \"dashboard\"` parses
  `raw` as `DashboardProposal` (`../../dashboards/types/proposal` — correct relative path from
  `features/assistant/ui/`, design-gate round 1 fix)"* — matching `design.md:86-90` (D4)'s
  `../../dashboards/types/proposal` exactly. Confirmed the path is objectively correct, not just
  internally consistent: `find frontend/src/features/dashboards/types -iname "*proposal*"` →
  `frontend/src/features/dashboards/types/proposal.ts`; `ls frontend/src/features/assistant/` shows
  no `types/` subdirectory (only `services/`, `state/`, `types.ts`, `ui/`), and a Python
  `os.path.normpath(os.path.join("frontend/src/features/assistant/ui", "../../dashboards/types/proposal"))`
  resolves to exactly `frontend/src/features/dashboards/types/proposal` — the real file's location.
  The round-2 gap is genuinely closed.
- **Broad grep sweep for abandoned round-1 ideas across all 5 artifacts + both spec deltas**:
  `ChatSurface`, `Refine with AI`, `usePortalPopover`, and the stale `../types/proposal` path. Every
  hit in a *live planning artifact* (`design.md`, `proposal.md`, `ticket.md`, `tasks.md`, both spec
  deltas) references these only as explicitly-rejected alternatives ("not `usePortalPopover`", "NOT
  the 'Refine with AI' button", "design-gate round 1 correction"). The only hits framing these as
  live/current decisions are inside `skeptic-design-1.md`/`skeptic-design-2.md` themselves (the
  historical record of what round 1 found wrong) — not planning artifacts an implementer follows. No
  `ChatSurface` extraction, no `usePortalPopover`-based overlay mechanism, and no "Refine with AI as
  precedent" claim survives anywhere live.
- Ran `openspec validate chat-surface-visual-design --strict` twice (reproduced) → both runs printed
  `Change 'chat-surface-visual-design' is valid`.
- Re-read `frontend/src/features/assistant/ui/ChatPage.tsx` (still 31 lines, no list, doc comment
  correctly states the list renders in `SidebarBody.tsx`'s `chat` branch) and
  `frontend/src/shared/chrome/SidebarBody.tsx` (still has the `section === "chat"` branch at line 219,
  `sectionFromPathname` gating on `/chat` prefix at line 287) — the D5 quick-launcher rescoping
  (active-conversation-only, no list duplication) remains grounded in real, unchanged source.
- Re-read `frontend/src/app/App.tsx:415-445` — "Refine with AI" (lines 423-433) is still gated by
  `onDashboardView && selectedDashboard !== null`; the theme-toggle button (lines 434-442) is still
  unconditional and uses the identical `.topbar-theme-btn` class. D7's cited precedent is correct.
- Re-read `frontend/src/shared/ui/Modal.tsx:1-40` — confirms it is the real, working canonical
  primitive (native `<dialog>`, `sm`/`md`/`lg` sizes, ESC + backdrop-click-close built in) D6 commits
  to.
- Re-read `frontend/src/features/assistant/ui/ActiveConversationPanel.tsx` in full — confirmed it is
  genuinely a title+message-count placeholder today (line 9 doc comment: "Deliberately minimal
  placeholder... NOT the real chat-bubble message-rendering UI (HEL-665's job)"), matching
  `proposal.md`'s "Why" framing and giving D1-D4's planned replacement a real, verified starting
  point.
- Re-read `frontend/src/features/assistant/types.ts` in full — `ClaudeToolMessageDto`
  (`role: string`, `content: ClaudeContentBlockDto[]`) and the discriminated
  `ClaudeContentBlockDto` union (`text`/`tool_use`/`tool_result`, with `toolUseId`/`isError: boolean`
  on `tool_result`) match every shape D1-D4 and the spec deltas reference.
- `git status --short` inside the worktree → only the untracked `openspec/changes/
  chat-surface-visual-design/` directory; no frontend code touched yet, as expected at the design
  gate.
- Checked AC-to-artifact traceability: AC1 (both entry points, one coherent system, DESIGN.md
  tokens) ← D1-D7 + all of `tasks.md` sections 1-4; AC2 (tool-call/search progress + propose→review
  hand-off) ← D2 + D4, spec delta scenarios in `chat-message-rendering/spec.md`; AC3 ("approved
  before entry-point-wiring ticket implements it") ← Planner Notes' two-skeptic-gate-structure
  reading, carried unchanged from round 1/2 as a disclosed, non-blocking residual-ambiguity note
  (unchanged text, re-read to confirm it still says what round 2 reported).
- Environmental note (matches round 2's documented workaround, not a new finding): this worktree's
  `scripts/concertino/` is missing `next-report-number.sh` (confirmed: `ls` shows 17 scripts in the
  main checkout vs. a smaller set here). Resolved by invoking the main checkout's copy by absolute
  path against this worktree's change directory, as round 2 did — no file outside my own report was
  created, copied, or modified.

### Verdict: CONFIRM

The single required revision from round 2 (the stale `../types/proposal` import path in `tasks.md`
task 2.2) is genuinely fixed and now matches `design.md` D4 exactly, verified against the literal
current file text and independently checked against the real file location on disk — not merely
against the round-2 paraphrase. A fresh, broad sweep across all five artifacts and both spec deltas
finds no resurfacing of any of round 1's abandoned ideas (`ChatSurface` extraction,
`usePortalPopover`-based overlay, "Refine with AI" as precedent) in any live planning artifact.
`openspec validate --strict` passes reproducibly. AC-to-task traceability is intact and the plan is
internally consistent across `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec
deltas. This is sound enough to implement.

### Non-blocking notes

- The AC3 "approved" residual-ambiguity flag in `design.md`'s Planner Notes (recommend a human
  glance at shipped screenshots/PR before HEL-666's cutover) is unchanged from rounds 1-2 and remains
  a reasonable, disclosed process recommendation, not a defect in this ticket's own artifacts.
- `design.md` D6's illustrative `Modal` usage snippet still omits the required `title`/`open` props
  `Modal.tsx` actually requires — as round 2 noted, this is clearly shorthand illustrating the
  decision (task 4.1's prose is the actual task spec), not literal planned code. Still not a required
  revision.
