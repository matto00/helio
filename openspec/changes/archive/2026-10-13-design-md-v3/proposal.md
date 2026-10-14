## Why

DESIGN.md binds every frontend ticket and the Skeptic gate, and the v0.9 re-design (epic HEL-1570) changes its foundations. The type default becomes sans + mono, there is a new rail + tabs shell, a motion system and a live-preview pattern. Today DESIGN.md v2 still says the opposite on type, has no shell or live-preview guidance, has only four ad-hoc motion tokens, and buries its rules under measurement forensics. HEL-1572/1573/1574/1583 are blocked on it, so it has to land first and has to be true of the running app on the day it lands.

## What Changes

- **DESIGN.md v3.** §0 is restated: warm neutral structure, scarce accent, sans + mono by default, Fraunces only as the optional "Serif headings" type style, and a "human touch" principle. Sections §0–§8 keep their numbers, because 99 §-numbered code comments cite them. New sections come after §8: §9 Shell (rail, context list, tabs, meta row, `⌘K`), §10 Motion (duration/easing tokens, primitives, Full/Subtle/Off + reduced motion), §11 Live preview (draft vs saved, the "live" marker, changed-row flash), §12 Mobile (glass nav v2, 10–12px gutters). There is also an Appendix holding the measurement/contrast forensics, and each moved block leaves a pointer behind.
- **Headings flip to sans (owner ruling `flip-now`, 2026-10-13).** A new `--font-heading` token defaults to `--font-sans`. Every `var(--font-display)` consumer (page titles, wordmark, auth headlines, main empty-state and onboarding titles) repoints to `--font-heading`. `--font-display` stays defined as Fraunces, as the face HEL-1572's "Serif headings" style will assign. **Visible change**: those headings render in Schibsted Grotesk.
- **Motion tokens in theme.css.** A named duration scale, a stagger step and easing curves are added to `:root`. The existing `--app-transition`/`--transition-slow`/loop tokens are unchanged.
- **Wider dark surface ramp (owner ruling `adopt`, 2026-10-13).** The dark canvas `--app-bg` goes from `#121110` to `#0f0e0d`, the value every approved round-2 board paints, and every runtime copy of it moves with it (appearance.ts, PWA theme colour). The approved boards disagree on the card surface, so `--app-surface` stays as it is, and so does the light theme. **Visible change** in the dark theme.
- No guard test is deleted or weakened.

## Capabilities

### New Capabilities
- `design-language-v3`: what DESIGN.md v3 must state (type default, shell, motion, live preview, mobile, forensics appendix) and the theme.css token contract behind it (heading-font token, motion tokens, dark ramp).

### Modified Capabilities
- `error-state-pattern`: the EmptyState `main` title renders in the heading face (`--font-heading`), not "the Fraunces display font".
- `page-shell-primitives`: the PageHeader title renders in the heading face per DESIGN.md, not "Fraunces per DESIGN.md §3".
- `pwa-installability`: the dark `theme-color` meta is `#0f0e0d`.

## Impact

- `DESIGN.md` (rewrite of §0, edits to §1–§8, new §9–§12 and an Appendix).
- `frontend/src/theme/theme.css` (new tokens, the dark `--app-bg` value, `.wordmark`/`.page-title` repoint).
- Six CSS consumers of `--font-display`: `auth.css`, `FirstRunDropZone.css`, `OnboardingChecklist.css`, `EmptyState.css`, `App.css`, plus theme.css's own utilities. `PageHeader.tsx` is a comment only.
- `docs/contrast-audit.md` and any theme guard tests whose transcribed dark values change. Guards are re-run, never loosened.
- `frontend/src/theme/appearance.ts`, `frontend/src/pwaConfig.ts`, `frontend/index.html` (dark canvas sync sites).
- No backend, API or schema change.
