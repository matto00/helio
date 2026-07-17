# HEL-304 — Panel appearance edits at <768px viewports are silently dropped

- **Type:** Bug (Iron Laws apply with full force — systematic-debugging: no fix without a probe-confirmed root cause; repro-widening required)
- **Priority:** High
- **Project:** Helio Mobile — PWA
- **URL:** https://linear.app/helioapp/issue/HEL-304/panel-appearance-edits-at-768px-viewports-are-silently-dropped

## Context

Found by the HEL-248 evaluator during review (pre-existing, not introduced by HEL-248). Reproduced conclusively: panel **appearance** edits made while the viewport is narrower than 768px do not persist — no error, no PATCH — until the viewport returns to desktop width.

## Observed / root-cause lead

`usePanelGridSave`'s flush logic only mounts inside `DesktopPanelGrid`. Below 768px the mobile shell renders `MobilePanelStack` instead, so pending appearance changes never flush. The mobile shell is intended to be read-only, but edit affordances are still reachable there (known follow-up: PanelDetailModal Edit button — see HEL-303), so a user can make an edit that silently vanishes.

## Expected

Either (a) edits made below 768px persist exactly like desktop, or (b) the mobile shell is made genuinely read-only so no edit path exists to drop data. Decide in planning; (b) overlaps with HEL-303's intent.

## Repro-widening note

Don't stop at the literal repro (appearance edit at phone width). Audit every mutation path that depends on components mounted only in `DesktopPanelGrid` (layout PATCH, column widths, appearance, anything using `usePanelGridSave`) at <768px, including tablet widths and browser-window resizes mid-edit on desktop.

## Acceptance criteria

- [ ] No user-visible edit path at <768px silently drops changes (each path either persists or is unreachable)
- [ ] Regression test covering the chosen behavior for appearance edits at mobile width
- [ ] Audit note in the PR listing every `usePanelGridSave`-dependent mutation path checked

## Session-specific directives (from the user, binding)

1. **Remedy decision in planning with evidence:** choose (a) persist-like-desktop or (b) genuinely read-only mobile shell. If (b): implement the **behavioral** guarantee here (no silent-drop path); leave pure styling polish to HEL-303 — do not absorb HEL-303's whole scope (HEL-303 already has an AC to remove reachable edit affordances on phone).
2. **HEL-301 regression guard:** browsing on mobile must never PATCH dashboard layout (xs layout byte-identity).
3. **Mutation-path audit is mandatory before fix design:** enumerate and probe EVERY mutation path depending on desktop-grid-mounted flush logic (appearance, layout, column widths, anything staged through `usePanelGridSave`) across phone width, tablet width, and a desktop window resized below 768px mid-edit. Include **collection panels** (`collection_options`, V57, HEL-247) in the audit.
4. **Elevated style/UX bar:** DESIGN.md compliance (tokens, canonical breakpoints 1440/1100/768/430). Clean up trivial style debt in files already being edited (in-scope files only).
5. **Mobile is a first-class verification target:** evaluator and skeptic verify at ~390×844 AND at a resized-desktop window below 768px. Acceptance bar = the ticket's ACs, including regression test + audit note listing every mutation path checked.
6. **Operational hygiene:** Playwright screenshots go to the session scratchpad or gitignored tmp — NEVER the repo root. Never bulk-delete by glob. HEL-247 cleanup may run in parallel — stay inside this worktree and these ports. `-n` commit bypass accepted only when check:openspec-hygiene is the sole pre-commit failure pre-archive; call it out.

## Context to verify (not trust)

- main includes HEL-245/255/248/247 (PRs #230–#233)
- Collections are a new panel kind (`collection_options` V57)
- `mobilePanelHeights.ts` has per-kind entries; `MobilePanelStack` is the <768px shell (HEL-300/301/302)
