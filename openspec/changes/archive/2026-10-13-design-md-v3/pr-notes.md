## Notes for the PR body (HEL-1571, DESIGN.md v3)

**Owner rulings applied (2026-10-13):** `flip-now` (headings render in sans through the new `--font-heading` token, wordmark included) and `adopt` (wider dark ramp).

**Card surface deliberately left unchanged.** Dark `--app-surface` stays `#1a1816`. The approved boards disagree on the card value: `#1c1a17` (B2 Dashboard, Pipeline live), `#1a1815` (Home) and `#171513` (Motion live, Appearance). Only the dark canvas `--app-bg` moved, `#121110` to `#0f0e0d`, which every approved board paints. The owner can pick a card value in a follow-up; a lighter card squeezes `--app-surface-strong` state contrast, so the guards must be re-run when it changes. The light theme is unchanged.

**Driver-default motion rules (not owner rulings), labelled as such in DESIGN.md §10:**
- No saved Motion preference plus OS `prefers-reduced-motion: reduce` means **Off** (the boards do not settle Off vs Subtle; HEL-1572's AC allows either).
- An explicit saved choice beats the OS setting (the OS is a default, not an override).
- Both are "default, revisit with the owner in HEL-1572". Interim: the unscoped global reduced-motion rule in `theme.css` stays, so an OS reduced-motion setting currently always wins; HEL-1572/1573 must scope it to users with no saved preference when `data-motion` lands.
- Also driver-derived: context-list widths min 200 / default 248 / max 400 (adjustable by HEL-1574 with a DESIGN.md edit), and the 40ms stagger step and 280ms standard duration (the boards run 30-50ms and 0.26-0.32s).

**Visible changes:** headings (page titles, wordmark, auth headline, main EmptyState/onboarding titles) render in Schibsted Grotesk; the dark canvas is `rgb(15, 14, 13)`.

**Open obligation recorded in §12:** the glass-nav v2 expanded label must clear 4.5:1 from rendered pixels, or HEL-1583 gives it an opaque lozenge.

**Spec handling:** the main spec `openspec/specs/pwa-installability/spec.md` was NOT edited; the change's MODIFIED delta carries the `#0f0e0d` update and archive applies it. Consequently `grep -rn 121110 openspec/specs` hits only that main spec's dark theme-color line until archive; frontend and docs are clean.
