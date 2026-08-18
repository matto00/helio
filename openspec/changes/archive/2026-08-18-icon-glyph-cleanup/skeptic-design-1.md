## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/nav-section-registry/spec.md` in full under
  `openspec/changes/icon-glyph-cleanup/`.
- **Sidebar registry ground truth** — `frontend/src/shared/chrome/sections.ts`:
  confirmed `/chat` entry (label "Assistant") uses `icon: MessageSquare` at
  line 103 and `/metrics` entry uses `icon: Gauge`, matching the ticket's
  claims exactly.
- **Single source of truth claim** — `frontend/src/app/Sidebar.tsx` (imports
  `navDestinations` from `../shared/chrome/navDestinations`, renders
  `<Icon ... size={16} .../>`) and `frontend/src/shared/chrome/BottomNav.tsx`
  (same `navDestinations` import, `size={22}`) both derive their icon set
  from the registry — confirms the "one edit fixes both surfaces" claim and
  the 16px collapsed-rail size cited in the ticket/spec delta.
- **Icon availability** — verified via `node -e` against the installed
  packages: `MessageCircle`, `ChartNoAxesColumn`, `Gauge`, `MessageSquare` all
  exist in `lucide-react`; `faSliders`, `faWandMagicSparkles`, `faCommentDots`,
  `faComments` all exist in `@fortawesome/free-solid-svg-icons`. No dependency
  bump needed, as claimed.
- **`CommandBar.tsx` ground truth** (lines 195-240): "Refine with AI" button
  (lines 208-218) uses `faCommentDots`; "Open assistant" button (lines
  223-233) uses `faComments`; both are `cmd-btn cmd-btn--icon`. Matches the
  ticket's description of the near-duplicate glyph problem and the target
  fix.
- **`DashboardAppearanceEditor.tsx` ground truth** (lines 269-283): trigger
  button currently `className="popover__trigger dashboard-appearance-editor__trigger"`
  with a visible `<span className="dashboard-appearance-editor__trigger-copy">Customize dashboard</span>`
  as its only content (no icon element at all today). Matches the "bespoke
  text-pill" description (ticket cites lines 271-282; actual is 271-280 —
  trivial, non-blocking drift).
- **`IconButton` primitive (HEL-718) status** — `grep -rn "IconButton" frontend/src`
  (excluding tests) returns zero component definitions. Confirms design.md's
  claim that HEL-718 has not landed and the `cmd-btn cmd-btn--icon` fallback
  is correctly chosen, not an invented "fourth variant."
- **CSS ground truth** — `frontend/src/app/App.css:163-171`: `.cmd-btn--icon`
  sets `width: var(--control-sm)` (`--control-sm: 28px` per
  `frontend/src/theme/theme.css:59`) and `padding: 0; justify-content: center;`
  — i.e. a fixed 28×28px icon-only square, not a variable-width pill.
  `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.css:1-20`
  confirms exactly two selectors scoped to the trigger:
  `.dashboard-appearance-editor__trigger` (padding/radius override — task 1.4
  correctly targets this for removal) and
  `.dashboard-appearance-editor__trigger-copy` (font-weight for the visible
  text span — **not** targeted by any task).
- **`usePortalPopover` positioning** — `grep -n "className\|classList\|querySelector" frontend/src/hooks/usePortalPopover.ts`
  returns no matches, confirming design.md's claim that popover positioning
  is ref-based, not class-based, so the class rename is safe for positioning.
- **Test-safety of the text removal** — `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.test.tsx:52`
  and `frontend/src/app/App.test.tsx:442` both query by
  `getByRole("button", { name: "Customize dashboard appearance" })`, i.e. by
  `aria-label`, not by the visible "Customize dashboard" text — so removing
  the text span would not itself break these two existing tests.
- **Spec delta correctness** — `openspec/specs/nav-section-registry/spec.md`
  has three existing requirements, none titled "Registry icons are visually
  distinct at collapsed-rail size" — the delta's `## ADDED Requirements`
  section is the correct OpenSpec form (no collision, no incorrectly-scoped
  MODIFIED/REMOVED). Proposal's claim that the `CommandBar.tsx`/
  `DashboardAppearanceEditor.tsx` changes need no spec delta (pure
  markup/CSS-class/icon-import inside an existing, unspecced mechanism) is
  reasonable and consistent with `openspec/specs/` having no button-styling
  capability.

### Verdict: REFUTE

### Change Requests

1. **`tasks.md` (task 1.3) / `design.md` do not account for the visible "Customize
   dashboard" text span, and as written the plan produces a broken button.**
   `DashboardAppearanceEditor.tsx:279` renders
   `<span className="dashboard-appearance-editor__trigger-copy">Customize dashboard</span>`
   as the button's *only* current content. Task 1.3 says to "drop
   `popover__trigger dashboard-appearance-editor__trigger`, add `faSliders`
   icon, preserve `aria-label`, add a `title` tooltip" — it never says to
   remove this text span (or its own CSS rule,
   `.dashboard-appearance-editor__trigger-copy` at
   `DashboardAppearanceEditor.css:18-20`, which task 1.4 also doesn't
   mention — 1.4 only covers the `__trigger` override). `.cmd-btn--icon` is a
   fixed **28×28px** (`--control-sm`), `padding: 0`, `justify-content: center`
   icon-only recipe (`App.css:163-171`) — it has no room for both an icon and
   the text "Customize dashboard." A competent implementer following task 1.3
   literally (add icon, keep everything else) would ship a squeezed/
   overflowing button, directly contradicting the ticket's own framing of
   this fix ("the only text button among the icon-only cluster... Move it
   onto the shared `cmd-btn cmd-btn--icon` recipe") and its own AC ("no
   residual pill-shaped styling" — tasks.md:24-25). This is exactly the kind
   of two-readable-ways ambiguity that should be closed before execution:
   revise task 1.3 (and design.md's corresponding Decision bullet) to
   explicitly state that the `dashboard-appearance-editor__trigger-copy`
   `<span>` is removed from the JSX (icon-only content, matching its
   `cmd-btn cmd-btn--icon` siblings in `CommandBar.tsx`), and extend task 1.4
   to also remove the now-orphaned `.dashboard-appearance-editor__trigger-copy`
   CSS rule alongside `.dashboard-appearance-editor__trigger`.

### Non-blocking notes

- Ticket/proposal cite `DashboardAppearanceEditor.tsx:271-282` for the
  trigger button; actual current span is lines 271-280. Immaterial to the
  plan's correctness — flagging only so the executor isn't confused hunting
  for two extra lines.
- **Environmental note on report tooling**: this worktree's
  `scripts/concertino/` is missing the gitignored, locally-generated scripts
  (`next-report-number.sh`, `persist-evidence.sh`, `emit-event.sh`, etc.) —
  only the git-tracked subset (`assert-phase.sh`, `cleanup.sh`,
  `setup-worktree.sh`, `start-servers.sh`, `README.md`, `.concertino.env`)
  is present. Per this directory's own `README.md` (documented fallback
  behavior for `emit-event.sh` when invoked from a worktree), I invoked the
  main checkout's copies of `next-report-number.sh`/`persist-evidence.sh`/
  `emit-event.sh` directly (they are generic, path-parameterized scripts with
  no repo-relative state) rather than treating this as a hard `BLOCKER`. Not
  a design defect in this change — noting it in case the worktree-setup
  script is meant to copy these and silently isn't.
