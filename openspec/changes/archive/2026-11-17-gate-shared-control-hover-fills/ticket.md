# HEL-1675: Gate hover fills behind (hover: hover) app-wide: shared controls in the sheet still stick after a tap; add the DESIGN.md rule

## Description

origin_kind: followup
origin_ticket: HEL-1668 (PR matto00/helio#1067, merged as d0c600fbf)

HEL-1668 gated pipeline-page `:hover` fills behind `@media (hover: hover)`, with a jest guard. Remaining:

1. **Shared controls.** Inside the phone step sheet, hover fills still stick after a tap on IconButton, ActionsMenu
   items, `.ui-modal-btn` and Select. Gate them in their shared styles.
2. **DESIGN.md rule.** Add an app-wide rule for `@media (hover: hover)`, and widen HEL-1668's guard to the shared
   components.
3. **Tidy:**
   * Merge the paired `@media (hover: hover)` blocks on the primary buttons.
   * The comment at the top of `PipelineSpineHeader.css` still says the meta line ellipsizes below about 1100px.
   * The 1280 "no reserved gap" e2e logs the gap but doesn't assert it.
   * Each source card runs two `useNow` timers; one would do.
   * `useTopModalDialog` observes the whole body subtree; narrow it.

## Acceptance Criteria

- No sticky hover after a tap on any shared control in the sheet (touch e2e, failing first).
- The guard covers the shared component CSS.
- Desktop hover is unchanged.

## Driver constraints (binding on every role)

- C1 never read/print any `.env`; no env-dumping commands. C2 quoted heredocs only. C3 no pkill/pgrep/killall; kill by
  exact PID; stop servers with scripts/concertino/stop-servers.sh. C4 jest maxWorkers 3, Playwright workers 2,
  sbt -J-Xmx3g, nice -n 19 for heavy runs. C5 long Bash calls take timeout 600000. C12 visual cohesion: compare against
  the running app in light and dark, desktop and phone; desktop hover visibly unchanged. C13 every new e2e fails first
  and waits on real readiness signals. C14 clean own dev-DB residue by exact id before Delivery.
- Active sibling lanes: HEL-1684 (pipelineDraft.ts, step spine, draft hooks, draft preview) and HEL-1678 (global
  typography @font-face). Keep spine-area edits minimal so HEL-1684 rebases cleanly.
