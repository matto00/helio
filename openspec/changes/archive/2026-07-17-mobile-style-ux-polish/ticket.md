# HEL-303 — Mobile style/UX polish pass — PWA follow-ups + <768px shell audit

- **Status:** In Progress (High priority)
- **URL:** https://linear.app/helioapp/issue/HEL-303/mobile-styleux-polish-pass-pwa-follow-ups-768px-shell-audit
- **Project:** Helio Mobile — PWA
- **Binding spec:** `notes/mobile-pwa-handoff.md`

## Context

The Mobile PWA project (HEL-300/301/302) shipped with several known, deliberately deferred polish items noted in the PR bodies and Linear closing comments. The v1.5 Panel System v2 phase (HEL-245/255/248/247, PRs #230–233) has since landed new/reworked panel config surfaces, and HEL-304 (PR #234) made panel-content edits persist width-independently. This ticket is the closing mobile polish pass: make the whole app — including the new v1.5 surfaces — look and feel right in the <768px mobile shell.

The PWA implementation spec `notes/mobile-pwa-handoff.md` is binding for this project.

## What

Known follow-ups:

- **MobileNavSheet rows are slightly under the 44px minimum touch target** — bring all sheet rows (dashboard + section rows) to ≥44px.
- **Edit affordances on phone** — UPDATED after HEL-304: content edits now persist correctly at <768px, so the Edit button may stay **if** it is fully functional and meets touch standards. The requirement is now: no *broken or misleading* edit affordance on mobile — anything desktop-only (layout drag/resize) must not be implied or reachable; anything reachable must work end-to-end at ≥44px.
- **Tune per-kind panel height constants** in `frontend/src/features/panels/ui/mobilePanelHeights.ts` — the shipped values are explicit starting points; verify each panel kind at a real phone viewport (~390×844) and adjust. Include the new `collection` panel kind (HEL-247, PR #233 — it currently has an intrinsic-height entry; verify it looks right with real multi-row data).

General audit:

- Sweep every panel type (Metric, Text, Markdown, Image, Table, Chart incl. all four chart types, Collection) in the MobilePanelStack at phone viewport: no horizontal overflow, readable type scale, sane heights.
- Sweep the mobile shell chrome (BottomNav, MobileNavSheet, PanelDetailModal) for token compliance (no hard-coded colors/spacing) and DESIGN.md conformance.
- Verify touch targets ≥44px across the mobile shell (the PanelDetailModal editor controls were already covered in HEL-245/255/248/247 — verify, don't redo).

Style-only pass — no behavior/backend changes (behavioral mobile-edit work shipped in HEL-304; residual layout edge tracked in HEL-306, out of scope). Fix trivial style debt encountered in touched files; anything non-trivial becomes a spinoff ticket reported to the orchestrator — do not fix inline.

## Acceptance criteria

- [ ] All MobileNavSheet rows measure ≥44px tall at 390px viewport width
- [ ] No broken or misleading edit affordance at <768px: desktop-only actions (layout drag/resize) unreachable/unimplied; every reachable edit path works end-to-end with ≥44px targets
- [ ] Every panel kind (incl. collection) renders in the MobilePanelStack at 390×844 with no horizontal overflow and no clipped content; `mobilePanelHeights.ts` constants adjusted where needed
- [ ] Mobile shell components use design tokens only (no hard-coded colors/spacing) per DESIGN.md
- [ ] Layout byte-identity preserved: browsing on mobile never PATCHes dashboard layout (regression guard from HEL-301/304)

## Session-specific emphasis (user-directed, binding)

- This ticket IS the style/UX cleanup mandate: the elevated DESIGN.md bar (tokens, canonical breakpoints 1440/1100/768/430) applies to every line.
- Evaluator AND skeptic verify at ~390×844 in BOTH light and dark themes; measure touch targets via `getBoundingClientRect`, never eyeball.
- The ≥44px `@media` pattern + CSS-lock tests from HEL-245/255/248 are the established mechanism — extend it, don't reinvent.
- HEL-304 mounts the panel-updates flush width-independently, so config edits during verification are safe at any width.

## Operational hygiene (binding for all agents)

- Playwright screenshots go to the session scratchpad or gitignored tmp — NEVER the repo root.
- Never bulk-delete by glob; delete only files you created, by exact name.
- HEL-304 cleanup may run in parallel — stay inside this worktree and its ports (dev 5476 / backend 8383).
- `git commit -n` bypass is accepted ONLY when `check:openspec-hygiene` is the sole pre-commit failure pre-archive; call it out explicitly.
