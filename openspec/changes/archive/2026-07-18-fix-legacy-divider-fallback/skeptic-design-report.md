## Skeptic Report — design gate (round 0)

### What I verified (with evidence)

1. **The bug claim is real.** `frontend/src/features/panels/ui/DividerPanel.tsx:12` resolves
   `resolvedColor = color ?? "var(--color-border)"`. `grep -n "color-border" frontend/src/theme/theme.css`
   returns nothing — the token doesn't exist in either the light or dark theme block. Confirmed dead reference.

2. **Token existence claim is real.** `frontend/src/theme/theme.css:95-96` (dark) and `:142-143` (light) define
   `--app-border-subtle` and `--app-border-strong` with light/dark values, matching DESIGN.md's "Border" row
   (`DESIGN.md:87`).

3. **Test-pins-dead-value claim is real.** `DividerPanel.test.tsx:31` asserts
   `rule?.style.backgroundColor).toBe("var(--color-border)")` — confirms the test would need updating regardless
   of which token is chosen.

4. **Repro-widening claim is accurate.** I independently ran a `var(--*)` sweep across
   `frontend/src/**/*.{css,ts,tsx}` diffed against tokens defined in `theme.css`. Result: the only undefined-token
   reference is `--color-border` (2 hits: component + test). The other flagged names
   (`--dashboard-background-override`, `--panel-surface-override`, `--panel-text-override`,
   `--dashboard-grid-background-override`, `--mobile-panel-height`, `--toast-intent-color`) match my own sweep
   exactly. The "no other dead references" claim in proposal.md / design.md holds up.

5. **Spec delta / tasks / ACs trace cleanly.** All 3 ticket ACs map to tasks (4.1 visible-in-both-themes; 3.2
   explicit-color no-regression; 2.1/2.2 dead-token removal + grep-verify). No placeholders, no TBDs, no scope
   drift, no missing contract updates (backend/schema untouched, correctly out of scope per Non-goals).

### Token-choice decision does not hold up against the codebase's own convention

This is the one substantive problem, and it's exactly the kind of thing a design gate exists to catch before an
implementation cycle is spent on it.

`design.md` Decision 1 picks `--app-border-strong` over `--app-border-subtle` for the **default, non-interactive**
divider color, reasoning purely from alpha percentages ("9%/11% ... risks reading as near-invisible"). I checked
this against actual codebase usage:

- `DESIGN.md:87` itself documents the tokens' roles: `--app-border-subtle` = **"default hairline"**,
  `--app-border-strong` = **"hover/emphasis."**
- `grep -rn "app-border-strong" frontend/src --include=*.css` returns ~30 hits. I traced the selector context for
  every `border-color: var(--app-border-strong)` usage (`App.css:116/259/299/330`, `PanelGrid.css:53/160`,
  `inputs.css:33`, `Modal.css:171`, `Popover.css:22`, `PanelDetailModal.css` ×8, `DashboardList.css` ×2,
  `PipelineDetailPage.css` ×6, `TypeDetailPanel.css:36`, `PanelCreationModal.css:125/273`,
  `SourceDetailPanel.css:61`, `PanelList.css:66/221`, `RunHistoryModal.css:66`, `AddSourceModal.css:177`,
  `TypeRegistryBrowser.css:61`, `ErrorBoundary.css:85`) — **every single one is gated behind `:hover`, `:focus`,
  or `:active`**. There is no existing precedent in this codebase for `--app-border-strong` as a static/resting
  border color.
- Conversely, there is a directly analogous existing case for a **static, always-visible 1px separator line**:
  `App.css:55-59`, `.app-command-bar__sep` — a real vertical divider rule in the toolbar chrome — uses
  `background: var(--app-border-subtle)` at 1px, and ships in production today. `PanelContent.css:59`
  (`.panel-content__text-line`, a loading-skeleton line meant to be visible) also uses `--app-border-subtle` as a
  static background. Both are the same shape of problem as `DividerPanel` (a passive 1px line, not an
  interactive-state affordance) and both use `subtle`, not `strong`.

So the design's rationale for rejecting `--app-border-subtle` ("recreating the bug in spirit") is asserted, not
evidenced, and is contradicted by an existing, shipping precedent in the very file (`App.css`) whose token table
(`DESIGN.md`) the design otherwise cites correctly. The design also doesn't acknowledge that choosing
`--app-border-strong` would be the **first instance in the codebase** of that token used for a static/resting
border/line rather than a hover/emphasis state — i.e., it's introducing a new usage pattern for an existing token
without flagging it as such or updating `DESIGN.md`'s token-role description to cover it.

This matters at the design gate specifically because the ticket's AC ("renders a visible line... bound to
DESIGN.md tokens") could pass mechanically with either token, but the *design-language consistency* is exactly
what the skeptic's final-gate UI judgment would reject on visual inspection — better to resolve the token choice
now than to spend an implementation+eval+skeptic cycle only to have it bounced at final gate for off-pattern
token usage.

### Verdict: REFUTE

### Change Requests

1. **Re-justify or change the fallback token.** Either:
   - (a) Switch the default to `--app-border-subtle`, matching `DESIGN.md`'s documented "default hairline" role
     and the existing `.app-command-bar__sep` / `.panel-content__text-line` precedent for static 1px lines, and
     update `design.md` Decision 1 accordingly (and the spec delta / tasks / proposal, which all currently name
     `--app-border-strong`); or
   - (b) If `--app-border-strong` is deliberately kept, `design.md` must (i) explicitly acknowledge this is a new
     usage pattern for that token (static/resting, not hover/emphasis) diverging from every existing usage in the
     codebase, (ii) provide actual visual evidence for the choice (e.g. a same-session screenshot comparing both
     tokens rendered as the divider rule against `--app-surface`/`--app-bg` in both themes) rather than alpha-
     percentage arithmetic alone, and (iii) note whether `DESIGN.md`'s "Border" row description needs a follow-up
     amendment to cover this new role, or explain why it doesn't.
   - Whichever token is chosen, `proposal.md`, `design.md`, `tasks.md`, and the spec delta must agree (currently
     all three name `--app-border-strong`, so if (a) is chosen all three need updating together).

### Non-blocking notes

- Once the token question is resolved, the rest of the plan (fix location, test update, probe-confirm protocol,
  mobile check, gates) is sound and requires no other changes.
