# HEL-439: Token audit: color / spacing / type-scale consistency sweep

## Description

`DESIGN.md` §3 declares tokens the single source of truth: no hardcoded hex/rgb where an `--app-*` color token applies, every `margin/padding/gap` on a `--space-*` token, every `font-size`/`font-weight` on a `--text-*`/`--weight-*` token. These rules are tagged **[mechanical]** (greppable) but have never been swept across the whole `frontend/src` tree, so drift has accumulated in older CSS modules. This ticket is the audit-and-fix pass that makes the mechanical rules actually hold.

## Acceptance Criteria

* `grep`-style audit over `frontend/src` shows zero hardcoded color/size/weight/family literals **for which a matching token already exists** remain unfixed, outside the documented §3 exceptions — see "AC #1 restated" below (revised after design-gate skeptic round 1: the original "zero literals, full stop" wording is unachievable together with "do not invent new tokens"; the off-scale residual with no matching token is enumerated completely as this ticket's deliverable rather than silently left unaccounted for).
* No visual regression: light and dark render identically to pre-change for all touched surfaces (spot-check via screenshots).
* New guard test(s) fail if a raw hex/px-font-size/numeric-weight is reintroduced into the swept files.
* `npm run lint` and `npm test` pass; zero new warnings.

## Scope

* Sweep every `*.css` and `*.tsx` under `frontend/src/` for violations of the `DESIGN.md` §3 mechanical rules:
  * Hardcoded hex / `rgb()` / `rgba()` where a `--app-*` color token exists (excluding the documented data exceptions: `AccentPicker` preset swatches, dashboard appearance presets in `theme/appearance.ts`, chart series palettes).
  * Literal `px`/`rem` `font-size` and numeric `font-weight` (replace with `--text-*` / `--weight-*`).
  * Literal `margin`/`padding`/`gap` values that should be `--space-*` (small optical tweaks ≤4px may stay literal per §3).
  * Ad-hoc `font-family` declarations (must be `--font-sans` / `--font-display` / `--font-mono`).
* Replace each violation with the correct token from `theme/theme.css`. Do not invent new tokens; if a needed value has no token, note it in the PR description rather than hardcoding.
* Intent colors (success/warning/error/info) must come from the intent tokens per §3, never raw hex.
* Add a lightweight guard test (co-located `*.css.test.ts`, following the existing `Modal.css.test.ts` / `inputs.css.test.ts` pattern) that scans the offending files and asserts no disallowed literals remain, so the sweep does not regress.

## Out of Scope

* Adding or renaming tokens in `theme.css` (a values change, not an audit).
* Light/dark parity semantics (covered by the light/dark parity ticket) and motion tokens (motion ticket).
* Replacing one-off components with shared primitives (shared-component coverage ticket).

## Reconciliation with sibling tickets (decided during Planning, 2026-08-25)

* HEL-652 (repo-wide spacing pass) and HEL-677 (page-shell padding literals) are strict subsets of this ticket's spacing scope. Both were closed as **Duplicate of HEL-439** — this ticket's enumeration supersedes them.
* HEL-680 (compact-chip token) requires adding a new token, which is explicitly out of scope here ("Do not invent new tokens"). It remains open as the vehicle for that specific remediation. **Revised after design-gate skeptic round 1:** the off-scale spacing residual this audit finds (~120 literals with no matching token, dominated by `6px`/`10px`/`14px`/`7px`/`5px`) is materially larger than "the one already-known compact-chip case" — HEL-680's stated remit will likely need broadening at PR review, or a further follow-up ticket filed to cover the rest. This audit does not auto-file that; it states the finding in the PR description for a human to decide.

## AC #1 restated (decided after design-gate skeptic round 1)

The original AC #1 ("zero hardcoded literals outside documented exceptions") is unachievable together with "do not invent new tokens" — a mechanical classification found ~120 off-scale spacing literals (>4px, no matching `--space-*` value) that cannot be closed without a new token. AC #1 is restated as: **zero literals for which a matching token already exists** remain unfixed; the off-scale residual is enumerated completely as this ticket's deliverable, not silently dropped.

## Deliverable shape (decided during Planning; revised after design-gate skeptic round 1)

This ticket produces (1) a mechanically-derived enumeration of every violation across all five DESIGN.md §3 categories, (2) exact-value (no-tolerance) token substitutions for the subset that matches a token exactly — measured at roughly 84-108 of ~200+ spacing literals >4px, a bounded minority, not "the vast majority" as originally assumed — and (3) the guard test(s), pinned against a baseline of the known off-scale residual so it doesn't spuriously fail on day one. Any violation with no matching token, or requiring restructuring rather than a straight exact-value substitution, is enumerated and left unfixed with a reason, rather than guessed or near-miss-substituted (a near-miss substitution would be a real, visible geometry change and violate the "no visual regression" acceptance criterion).
