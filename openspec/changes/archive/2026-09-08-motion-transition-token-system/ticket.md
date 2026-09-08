# HEL-441: Motion & transition system: consistent durations and easings

## Description

`DESIGN.md` defines motion tokens and the rule "one entrance per surface; no scattered micro-animations"
**[judgment]**. In practice components declare ad-hoc `transition:` durations/easings and some surfaces animate more
than once, so motion feels inconsistent.

## Scope

* Audit all `transition`/`animation`/`@keyframes` declarations in `frontend/src` CSS modules.
* Replace ad-hoc durations/easings with `--app-transition` (hover/color state changes) or `--transition-slow`
  (surface entrances). If an easing curve is needed repeatedly, add a single easing token to `theme.css` and
  document it in `DESIGN.md` rather than repeating literals.
* Enforce "one entrance per surface": modals/popovers/toasts/auth card animate in once (fade + 4-10px rise). Remove
  redundant nested entrance animations.
* Confirm `prefers-reduced-motion` is respected globally and that no touched animation bypasses it.

## Acceptance criteria

* No CSS module declares a literal transition duration/easing where a motion token applies; enforced by a guard test
  alongside the token-audit guards.
* Each overlay surface (Modal, Popover, Toast, auth card) plays exactly one entrance animation; verified visually.
* Under `prefers-reduced-motion: reduce`, all touched transitions/animations are suppressed or reduced.
* Any new easing token is documented in `DESIGN.md`. `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope

* Panel interactivity hover/tooltip motion (HEL-350 lane).
* New entrance choreography or decorative animation.

## Orchestrator Planning-phase audit — MEASURED, ticket is MINOR-STALE

Full evidence: `.concertino/runs/HEL-441/evidence/premise-validation.md`. Measured with a multi-line-aware parse
across 110 CSS files; a line-oriented grep truncates these declarations and reports garbage.

**The headline premise is largely already fixed.** Of 136 `transition:` declarations, 51 use a motion token and only
THREE files carry a literal duration: `PanelGrid.css` (180ms x3), `theme.css` (0.16s, inside the reduced-motion
block), `BottomNav.css` (0.01ms, a reduced-motion override). Two of those three are legitimate reduced-motion literals. **The
third, `PanelGrid.css`'s 180ms, is deliberately PRESERVED — see design.md D4-REVISED**: folding it would widen the
layout-motion spread rather than narrow it, and HEL-1032 owns the real fix. Do not infer from this line that a fold is
expected. DESIGN.md documents
THREE motion tokens, not two, at `### Radius / Shadow / Motion` (line 279) — and already states the nuance the
ticket omits: `--app-transition` and `--transition-slow` are transition SHORTHANDS (duration+easing combined), and
"a continuous loop needs its own duration token rather than reusing either (0.28s repeated indefinitely strobes)".

**What genuinely remains:**

| finding | evidence |
| -- | -- |
| `auth-card-in 0.45s cubic-bezier(0.3, 0.9, 0.4, 1)` | the ONE entrance still on a literal; its curve duplicates `--transition-slow`'s exactly, only the duration differs (0.45s vs 0.28s) |
| loop durations have no scale | `ui-spinner-spin 0.7s` vs `pipeline-run-spin 0.8s` — SAME visual role (linear infinite spin), two speeds. Plus `streaming-text-blink 1s`, `pipeline-run-pulse 1.2s`, against one loop token (`--app-skeleton-shimmer: 1.6s`) |
| `PanelGrid.css` 180ms | a THIRD motion category (layout/drag) no token covers, between 0.16s and 0.28s |
| `--toast-exit-duration: 200ms` | defined locally in `toast.css`, not `theme.css`; DESIGN.md documents no exit motion at all |

**Already satisfied, do not redo:** the global `prefers-reduced-motion` rule exists in `theme.css` (blanket
`*, *::before, *::after`, `!important`), with 7 component-level overrides for loops exactly as DESIGN.md prescribes.
`frontend/src/theme/tokenAuditSweep.css.test.ts` is the real shared guard infrastructure the AC assumes.

**Entrance inventory (15 `@keyframes`, 20 `animation:` declarations).** Already tokenized: Modal
(`--transition-slow`), Popover (`--app-transition`), Toast (`--transition-slow`), MobileNavSheet and
RefinementChatDrawer (backdrop `--app-transition` + panel `--transition-slow`), OnboardingChecklist. Whether a
backdrop+panel pair counts as ONE entrance or two is a judgment call that must be settled against the RUNNING APP,
not the stylesheet.
