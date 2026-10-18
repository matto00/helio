# HEL-1669: Accent contrast: accent-ink on accent-strong hover is 3.95:1 in light (app-wide); light Dry-run hover barely differs from rest

## Description

origin_kind: followup
origin_ticket: HEL-1582 (PR matto00/helio#1060). Parent epic: HEL-1570.

* **Accent hover contrast.** The token pair `--app-accent-ink` on `--app-accent-strong` (primary-button hover, e.g. Run pipeline, and desktop primary buttons) measures 3.95:1 in the light theme, below 4.5:1 for text. HEL-1582 pinned it at 3.9 or above as a named exception. Fix the token pair app-wide, not per component.
* **Light Dry-run hover.** The hover fill differs from its rest fill by only 1.025:1. It passes the 1.10 floor against the backdrop, but the hover is barely visible.

## Acceptance Criteria

* Accent hover text is at least 4.5:1 in both themes.
* The Dry-run hover is visibly distinct from its rest fill (at least 1.10:1 against the rest fill).
* Compared against the running app, in light and dark, on desktop and phone. Remove HEL-1582's exception pin.

## Run constraints (driver brief, overnight mode)

* DESIGN.md is binding: fix the token pair, not per-component overrides.
* Compare against the running app on desktop and phone, light and dark, for every surface that uses `--app-accent-strong` as a hover; persist screenshots in `/home/matt/Development/helio/.concertino/scratch/HEL-1669/`.
* Before Delivery, run the full e2e suite locally under the e2e lock. No release.
* Reversible UI decisions may be built if easily reversible; list each in the PR body under "UI decisions taken overnight".
