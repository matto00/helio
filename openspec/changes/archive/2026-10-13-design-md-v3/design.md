## Context

See proposal.md for the motivation. Constraints that shape the approach:

- **Code comments cite DESIGN.md by section number**: the grep prints 154 DESIGN.md references in `frontend`/`e2e`, 99 of which carry a § number (§0–§8). (The skeptic's design-gate count corrects the earlier "153".) Renumbering would make them stale pointers.
- **No test or script reads DESIGN.md's content** (no `readFile`/path-join hits on `DESIGN.md`). The doc is guarded by review, not by tests. The tokens it names, though, are guarded by `frontend/src/theme/*.css.test.ts`.
- `openspec/specs/design-doc-hit-expander-guidance` requires §3 Control metrics to state the expander tiling formula, the gap rule, `elementFromPoint` bisection and the epsilon. Those stay in the body.
- `motionTokenGuard.css.test.ts` pins exactly **132** CSS files under `frontend/src` and forbids literal durations in `transition:`/`animation:` declarations. This change adds **no CSS file**.
- Owner rulings recorded 2026-10-13 (escalation `HEL-1571-1791943454149-f7eac8`, channel chat): sub 1 `flip-now`, sub 2 `adopt`.
- Design reference (gitignored): `/home/matt/Development/helio/.concertino/design/HEL-1570/`. Precedence: ticket ACs and owner rulings, then HANDOFF.md, then the boards. The boards' hex values and `#f97316` accent are illustration only.

## Goals / Non-Goals

**Goals:** DESIGN.md v3 is true of the running app on the day it merges. The four acceptance-criteria sections exist. Motion tokens exist. Headings render in sans. The dark ramp is the boards' ramp. Forensics move to an appendix with pointers left behind.

**Non-Goals:**
- No shell, tabs, `⌘K`, Home, live preview, glass nav v2 or gutter implementation. Those belong to HEL-1574/1575/1576/1578/1579–1581/1583, and DESIGN.md describes them as the binding target.
- No Motion setting plumbing (`data-motion` attribute, per-user persistence) and no motion primitives (HEL-1572, HEL-1573).
- No migration of existing consumers onto the new motion tokens (HEL-1573).
- No light-theme ramp change.

## Decisions

**D1. Keep §0–§8 numbering and append new sections.** New sections: §9 Shell, §10 Motion, §11 Live preview, §12 Mobile (glass nav v2 + gutters), then "Appendix A: Measurements and forensics" with subsections A.1… The old "Radius / Shadow / Motion" subsection in §3 keeps radius/shadow and replaces its motion prose with a one-paragraph pointer to §10. That paragraph keeps the HEL-441 rules: the loop-token rule, the backdrop+panel single-entrance rule and component-scoped exit motion. *Alternative:* renumber so that Motion sits next to Tokens. Rejected because it would silently stale 153 citations.

**D2. Forensics go to an appendix inside DESIGN.md, not to `docs/`.** Code comments cite "DESIGN.md §3 HEL-866 note", "§8 HEL-1046" and so on, so keeping the text in the same file keeps every citation grep-resolvable. What moves:
- §3 Color: the HEL-533 audit narrative and the HEL-866 three-backdrop table/derivation.
- §3 Surfaces: the HEL-774 material/floor/lozenge/accent-on-surface/`-3px` measurements.
- §3 Control metrics: the HEL-772 measurement narrative (35.75px etc.).
- §8: the HEL-1046 history, the HEL-1050 per-site inventory and the HEL-1048 derivation detail.
- From the two trailing HEL-444 sections: the "HEL-444 re-test" section moves in full. The "Light/dark token-parity rule (HEL-444)" **rule stays in the body** (it is normative and `themeParityGuard` enforces it); only its measurement sentences (the `f20ea8f6` token counts) move.

Each body location keeps its **normative rule** in one to three sentences plus "see Appendix A.n". The rules that stay are: which state rung for which backdrop (as a 3-row table, which is a rule, not forensics), the BottomNav ≥3:1 glyph and lozenge floors, the `-3px` offset, the expander tiling rule with every clause `design-doc-hit-expander-guidance` requires: the `(44 - controlSize) / 2` formula, the twice-extension gap, that `getComputedStyle(el, "::after").width` and painted-box sampling cannot detect an overlap, `elementFromPoint` bisection, the legitimate ~43.75px abutting reading with its epsilon, and the no-widening warning, and the focus-ring token rules. Moved text keeps its HEL-ids so a `grep HEL-866 DESIGN.md` still lands in the right place. *Alternative:* `docs/design-forensics.md`. Rejected because it breaks in-file grep for cited comments; the ticket allows either location.

**D3. Heading font via `--font-heading` (ruling flip-now).** In `:root`, add `--font-heading: var(--font-sans);` and keep `--font-display: "Fraunces", …` unchanged as the serif face. Repoint every `var(--font-display)` consumer to `var(--font-heading)`:
- `theme.css` `.wordmark` and `.page-title`
- `auth.css` ×2
- `FirstRunDropZone.css`
- `OnboardingChecklist.css`
- `EmptyState.css`
- `App.css`

Update the `PageHeader.tsx` comment. HEL-1572 will later set `--font-heading: var(--font-display)` under its type-style attribute, so one token switches the style. The wordmark is included (ruling `flip-now`, not `flip-keep-wordmark`). Keep the Fraunces `<link>` in `index.html`: Google Fonts only downloads a face that is actually used, so an unused family costs CSS bytes, not a font download, and HEL-1572 needs it. Re-check letter-spacing, weight and size at each repointed site visually. Serif metrics differ from Grotesk, so a wordmark tracked for Fraunces may need its letter-spacing reviewed, using tokens only. *Alternative:* rename `--font-display` to sans. Rejected because the name would lie and HEL-1572 would lose its serif handle.

**D4. Motion tokens (values from the approved Motion / Motion II boards).** Add to `:root` in theme.css, beside the existing motion tokens. These are custom-property declarations, not `transition:` declarations, so `motionTokenGuard` is unaffected.

| token | value | source |
|---|---|---|
| `--motion-duration-quick` | `160ms` | hover/colour; equals today's `--app-transition` |
| `--motion-duration-standard` | `280ms` | entrances, crossfade, indicator slide, layout slide, sidebar collapse, nav-label expand; equals `--transition-slow` (the boards run these at 0.26–0.32s; 280ms keeps one value) |
| `--motion-duration-emphasized` | `420ms` | panel/card rise (`rise .42s`) only |
| `--motion-duration-highlight` | `1200ms` | changed-row flash (`flash 1.2s ease-out`) |
| `--motion-stagger` | `40ms` | per-item stagger (boards 30–50ms; HEL-1573 "about 40–50ms") |
| `--motion-ease-standard` | `ease` | colour/opacity |
| `--motion-ease-out` | `cubic-bezier(0.3, 0.9, 0.4, 1)` | the boards' and `--transition-slow`'s curve |
| `--motion-ease-overshoot` | `cubic-bezier(0.2, 0.9, 0.3, 1.1)` | "a little give" (`pop`); never under Subtle |

`--app-transition`/`--transition-slow` are left as they are. DESIGN.md §10 states their equivalence and that new code uses the `--motion-*` scale, and HEL-1573 migrates the old consumers. Changing their declarations now buys nothing and risks pinned-literal guards.

**D5. Motion setting rule (stated in §10; implemented by HEL-1572/1573).**
- `Full`: every primitive.
- `Subtle`: opacity/colour fades only; no translate, scale, overshoot or layout slide; value tweens swap instantly.
- `Off`: no transform or position animation, and no fades beyond the instant.
- No saved preference: follow `prefers-reduced-motion`. `reduce` gives `Off`, consistent with the existing global `@media (prefers-reduced-motion: reduce)` rule in theme.css, which stays. Otherwise `Full`.
- An explicit saved choice wins over the OS setting (the Appearance board's copy, "Defaults to your system's reduce-motion setting", makes the OS a default, not an override).
- The root attribute is `data-motion="full|subtle|off"`, owned by HEL-1572.

The doc states this as the contract and does not claim it is wired today. **Interim implementation, stated in §10:** the unscoped global `@media (prefers-reduced-motion: reduce)` rule in theme.css (`!important` near-zero durations) stays as it is. While it stands, an OS reduced-motion setting always wins and an explicit "Full" choice cannot override it. HEL-1572/1573 must scope that rule to users with no saved preference (for example `:root:not([data-motion])`) when they add the attribute. **Provenance labels in §10:** "no preference + OS reduce means Off" and "an explicit choice beats the OS" are **driver defaults**, not owner rulings. The boards do not settle Off vs Subtle, and HEL-1572's own AC allows either. §10 marks both "default, revisit with the owner in HEL-1572".

**D6. Shell, live preview and mobile rules stated in DESIGN.md** (from HANDOFF.md + boards):
- **Rail:** 56px, always visible, icon-only with tooltip and `aria-label`, active item = accent-dim wash + accent icon, avatar at the foot. Usage leaves primary nav.
- **Context list:** resizable by a drag handle, collapsible to the rail. Widths: min 200px, default 248px (board ≈247px), max 400px. Width and collapsed state persist per user. Dashboards get folders with counts.
- **Tabs:** one per open dashboard, the active tab marked by an accent top indicator. Tabs persist server-side with a TTL (warm within it, reload after it, never lost). Tabs carry dashboard identity, so the dashboard page has **no title**.
- **Meta row:** slim, mono, `--text-xs`, muted. Panel count · refreshed (success dot) · source, with actions trailing and one primary.
- **`⌘K`:** box in the tab bar, placeholder "Search, jump, or ask", hands off to the Assistant. The Home and Pipeline top bars carry a small sans breadcrumb/label, not a display h1. Section pages keep `PageHeader`/`.page-title` until the shell tickets migrate them, and §6 says so.
- **Live preview:** draft vs saved (nothing is written until "Save & run"; Discard is secondary; the draft chip "Draft · unsaved changes" with an accent dot). The "live" marker is a success-intent dot plus mono lowercase "live", used only on surfaces recomputed from the current draft. Changed rows flash an accent wash at 30% fading to transparent over `--motion-duration-highlight` with `--motion-ease-out`. The board uses the `ease-out` keyword; one ease-out curve is kept deliberately so the system has a single deceleration shape; under Subtle the flash stays (it is a fade), and under Off there is no flash and a static changed marker is enough.
- **Accent discipline:** the accent goes on the primary action, selection, active indicators and focus only.
- **Mobile:** edge gutters `--space-3` (12px; 10px allowed only as an optical tweak ≤4px under §3's rule). Glass nav v2 has 5 tabs; the active tab expands to show its label (width transition on `--motion-duration-standard` + `--motion-ease-out`). The HEL-774 glass carve-out and its ≥3:1 floors still bind. Because the active label is text over translucent material, the label must clear 4.5:1 measured from rendered pixels, or HEL-1583 must give it an opaque lozenge. DESIGN.md states this as an open obligation on HEL-1583, not as a measured fact.

**D7. Dark ramp (ruling adopt): derive only what the approved boards settle.** Provenance: the owner answered `adopt` after being told "No board gives values". The values below are a derivation the driver asked for ("derive from what the board sources actually use … escalate a choice the boards don't settle"), not values the owner chose. Precedence per HANDOFF.md: rows 3–4 (B2Dashboard, Home, PipelineLive, MotionLive, Appearance) are the approved direction; row 2 boards are earlier explorations.

- **Canvas (settled):** every row-3–4 board paints the canvas `#0f0e0d` (B2Dashboard, Home, PipelineLive, MotionLive, Appearance). The row-2 boards (DashboardMobile, PipelineMobile, Motion) use `#11100e`, and the precedence above resolves that. So `--app-bg` `#121110` → `#0f0e0d`.
- **Card surface (NOT settled):** the row-3–4 cards are `#1c1a17` (B2Dashboard, PipelineLive), `#1a1815` (Home) and `#171513` (MotionLive, Appearance). That is three values spanning both sides of today's `#1a1816`. Picking one would be a choice the boards do not make, so `--app-surface` **stays `#1a1816`** (status quo, within one RGB step of Home's value). The ramp still widens, because the canvas moves darker under unchanged surfaces. The report to the owner flags this as overridable.
- **soft/raised/strong:** unchanged. Board chrome `#13110f`–`#171513` sits around today's soft `#161514`.
- **Light theme:** **unchanged**. No approved board is light, and the ruling was for a dark ramp. §2 records this explicitly.

**Sync sites for the `--app-bg` dark value** (runtime source, not test transcriptions; all must move together):
- `theme.css` `:root[data-theme="dark"]` `--app-bg` and the comment at ~L455
- the `--app-selection-bg` static fallback (regenerated by `buildSelectionBackground` over the new base; `--app-accent-text`'s fallback is regenerated by `deriveAccentTextColor` if its scored set changes)
- `appearance.ts`: `themeAppearancePalette.dark.appBackground` (~L80), the `FOCUS_RING_SURFACES` entry (~L355), `ACCENT_TEXT_NEUTRAL_SURFACES.dark` (~L483) and `SELECTION_BASE_HEX.dark` (~L597)
- `pwaConfig.ts` `APP_BG_DARK` and its doc comment
- `frontend/index.html`'s dark `theme-color` meta
- `openspec/specs/pwa-installability` (MODIFIED delta in this change)
- `docs/contrast-audit.md` dark rows

Find them with `grep -rn "121110" frontend docs openspec/specs`. Expect zero hits after the change except archived history.

**Guard protocol:**
1. Run every `frontend/src/theme` test, `PanelDetailModal.themeAwareFallback.test.tsx`, `pwa*` tests and the e2e `state-surface-contrast-guard.spec.ts`.
2. A guard or test that holds a transcription of the old hex may have that value regenerated by the derivation the guard or its source specifies. Extending an allow-list with a token this change introduces (for example `tokenAuditSweep`'s font allow-list gaining `--font-heading`) is also allowed. Never edit a threshold, widen a pattern or delete an assertion.
3. If a *threshold* fails, **stop and escalate**.

**Body measurements that go stale:** the HEL-866 rung table kept in §3 has a dark "measured" column taken on the old ramp. Family 3 (`--app-surface-raised` on `--app-bg`) changes with the new canvas, while families 1–2 do not change because surfaces are unchanged. Re-measure family 3 with the e2e guard's own method and update the cell, or, if the measurement isn't available, move the dark column to the appendix dated "measured on the v2 ramp". `DESIGN.md:1052`'s `#1a1816` citation is unaffected (surface unchanged). Its `#121110`-dependent neighbours (OrbitMark on `/login`) are in the HEL-444 re-test, which moves to the appendix as a dated record.

## Risks / Trade-offs

- [Visible change on every heading and on the dark canvas] → Render-check in both themes against the running app (dev 7003 / backend 9910). Screenshots go to evidence for: Dashboards, a section page with `.page-title`, `/login`, an EmptyState main, onboarding, mobile 390×844.
- [Pinned static fallbacks derived from `--app-bg` (`--app-selection-bg`, etc.) drift] → Recompute them with the source's own derivation (D7, step 2).
- [Near-threshold state contrast] → A darker canvas *raises* the family-3 contrast (`--app-surface-raised` on `--app-bg`). Keeping `--app-surface` unchanged avoids the ~1.111-vs-1.10 squeeze the skeptic computed for `--app-surface-strong` on a lighter `#1c1a17`.
- [Sidebar/context list paints `--app-surface`, lighter than the new canvas; the boards put chrome darker than cards] → No re-skin here (the shell belongs to HEL-1574). Captured in the render check and noted in §9 as a target for HEL-1574.
- [Moving forensics silently drops a normative rule] → Tasks require a before/after checklist. Every `[mechanical]`/`[judgment]` tag present in v2 must still be present in v3, compared with a command (`grep -c`, plus a diff of the tagged rule lines).
- [Shell/live-preview rules over-specify ahead of implementation tickets] → They are stated as the binding target. Numbers the boards do not fix (context-list min/max) are marked "adjustable by the owning ticket with a DESIGN.md edit".
- [Stale tokens named in DESIGN.md] → A command extracts every `--[a-z0-9-]+` token named in DESIGN.md and checks each against `theme.css` or the runtime-set list. It is recorded as evidence.

## Migration Plan

Docs + CSS only. Rollback is a revert of the squash commit. No data migration.
