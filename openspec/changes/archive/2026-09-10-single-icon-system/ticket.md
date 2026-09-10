# HEL-443: Iconography consistency pass (single icon system)

## Description

The app ships two icon systems: `lucide-react` and FontAwesome
(`@fortawesome/react-fontawesome` + `@fortawesome/free-solid-svg-icons` +
`@fortawesome/free-brands-svg-icons` + `@fortawesome/fontawesome-svg-core`).
Two icon families mean inconsistent stroke weight, sizing, and metaphor —
visible incoherence and doubled bundle weight. `DESIGN.md` §0.5 ("details are
gallery-grade") and the cohesion goal of this epic (HEL-346, v0.7 UI/UX
Cohesion) require one system.

**Corrected inventory (premise-validated 2026-09-10, re-derived at branch
time against `origin/main` `d8d398ca`; supersedes the ticket's original
Context section, which was stale):**

- `@fortawesome/*` imports: **57 files** in `frontend/src`, **67 distinct
  icon symbols** (`fa*`).
- `lucide-react` imports: **32 files**.
- FontAwesome is the **more broadly used** system today — the original
  ticket's rationale ("lucide already the more broadly used one") is
  inverted from reality and is dropped as a justification.
- `frontend/src/app/App.tsx` — the file the original ticket named as the
  starting point, citing `ChevronDown`/`PanelLeftClose`/`PanelLeftOpen`
  (lucide) and `faArrowRotateLeft`/`faArrowRotateRight`/`faSun`/`faMoon`
  (FontAwesome) — imports **neither** icon library today. That specific
  file-level claim is stale; those icon usages have already moved or been
  removed by unrelated prior work. The full 57-file inventory above is the
  actual scope.
- `frontend/package-lock.json` carries 18 `@fortawesome` entries — the
  dependency is still fully live in the lockfile.

**Why lucide is still the chosen survivor, despite the usage-share reversal:**
lucide-react is a stroke-based icon set that matches the app's hairline
aesthetic (`DESIGN.md`'s border/stroke language); FontAwesome's solid-fill
glyphs do not. The choice is made on design-language grounds, not on which
system happens to have more call sites today.

**Driver ruling (2026-09-10, recorded in
`.concertino/runs/HEL-443/evidence/premise-validation.md` and
`events.jsonl`; not an owner ratification, owner asleep):** proceed with
this restated scope, as one ticket, no split. AC1 (below) is unambiguous and
file-count-independent, so this correction is premise validation doing its
job, not a scope change requiring owner sign-off.

## Acceptance Criteria

- Zero imports from `@fortawesome/*` remain anywhere in `frontend/src`
  (import-based enumeration, including re-exports/aliases/dynamic
  `import()` — not name-based grep alone); the `@fortawesome/*` packages are
  removed from `frontend/package.json` **and** `frontend/package-lock.json`.
- All icons render from `lucide-react`, at one of a standardized, documented
  fixed size set (mechanism + set recorded in `design.md`).
- Icon-only interactive controls have accessible names; decorative icons are
  `aria-hidden`. This must be proven against a fixture containing at least
  one pre-fix non-compliant icon (red before the fix, green after) — not
  validated only against an already-compliant fixture.
- Bundle no longer includes FontAwesome; `npm run build`, `npm run lint`,
  `npm test` pass with zero new warnings.

## Out of scope

- Redrawing or theming individual glyphs beyond swapping to the equivalent
  lucide icon.
- The OrbitMark brand logo (not an icon-set glyph).

## Dependencies

None. Related (non-blocking): HEL-548, HEL-784, HEL-740 (adjacent icon /
empty-state polish, not overlapping this ticket's file enumeration).
