## Context

`DESIGN.md` §3 token rules (`[mechanical]`):
- Color: "No hardcoded hex/rgb/rgba in component CSS or TSX where a token
  applies." Documented exceptions: `AccentPicker` preset swatches, dashboard
  appearance presets (`theme/appearance.ts`), chart series palettes.
- Spacing: "All margin/padding/gap use a `--space-*` token (small optical
  tweaks ≤4px may be literal)." Scale: `--space-1` 4px, `-2` 8px, `-3` 12px,
  `-4` 16px, `-5` 20px, `-6` 24px, `-7` 32px, `-8` 40px, `-9` 48px, `-10` 64px.
- Typography: "Every `font-size` uses a token — no literal px/rem." Scale:
  `--text-micro` 10px, `-xs` 12px, `-sm` 14px, `-base` 16px, `-lg` 18px,
  `-xl` 20px, `-2xl` 24px, `-3xl` 30px. Weights: `--weight-regular` 400,
  `-medium` 500, `-semibold` 600, `-bold` 700. Families: `--font-sans`,
  `--font-display`, `--font-mono` — "No ad-hoc `font-family`."

## Goals / Non-Goals

**Goals:** a complete, mechanically-derived (not hand-sampled) enumeration
of violations; safe 1:1 token substitutions applied; a regression guard.

**Non-goals:** new tokens (this audit's off-scale residual — ~120 spacing
literals with no matching token, materially larger than "one known case" —
is enumerated but not fixed here; see the HEL-680 reconciliation below);
light/dark parity semantics; motion tokens; replacing components with shared
primitives.

## Decisions

### Enumeration methodology (must be mechanical, not sampled)

Run against `frontend/src/**/*.css` and `frontend/src/**/*.tsx`, excluding:
`theme/theme.css` (token definitions themselves), `theme/appearance.ts`,
`AccentPicker.*`, any chart-series-palette module, **`**/*.test.ts(x)`**
(fixtures, not styling), **code comments** (`/* ... */` and `//` lines),
`MfaEnrollModal.tsx`'s QR-code `bgColor`/`fgColor` (functional black/white,
not themeable), and `PreferencesEditor.tsx`'s appearance-default literals
(same "data, not styling" rationale §3 already grants `theme/appearance.ts`).

1. **Color:** `grep -rEn "#[0-9a-fA-F]{3,8}\b|rgba?\(" <files>` (post-exclusions).
2. **Spacing:** `grep -rEn "(margin|padding|gap)(-[a-z]+)?:\s*[0-9.]+(px|rem|em|%)"
   <files>` — **includes `em`/`%`**, not just `px`/`rem` (a `px|rem`-only
   pattern misses live `em` instances, e.g. `MarkdownPanel.css`,
   `MobileNavSheet.css`, `EmptyState.css` — verified present in this tree).
   Every hit where the literal (or the largest shorthand component) is
   > 4px-equivalent and not already `var(--space-*)`.
3. **Font-size:** `grep -rEn "font-size:\s*[0-9.]+(px|rem|em|%)" <files>` —
   same em/% widening as spacing. **Known finding: this category is
   currently clean (0 live violations)** — keep the check as a regression
   guard, not because violations are expected.
4. **Font-weight:** `grep -rEn "font-weight:\s*[0-9]+" <files>` (numeric,
   not `var(...)` or a keyword like `bold`). **Known finding: also currently
   clean (0 live violations)** — same rationale, regression guard only.
5. **Font-family:** `grep -rEn "font-family:" <files>` — every hit not
   referencing `var(--font-sans|--font-display|--font-mono)` **and not the
   CSS-valid keywords `inherit`/`initial`/`unset`** (verified: all 10
   non-token hits in this tree today are `inherit`, none are ad-hoc families).

Each hit gets a row: file, line, literal value, proposed token (**exact**
matching scale value only — no tolerance, see Verification below), and
disposition (`fix` | `flag: no-token` | `flag: optical-tweak-≤4px`).

### Verification (both directions)

- **Nothing missed:** patterns now cover `px|rem|em|%` for spacing/font-size,
  not just `px|rem` — the earlier px/rem-only version had a known, confirmed
  gap (em-unit literals in `MarkdownPanel.css`/`MobileNavSheet.css`/
  `EmptyState.css`). A residual gap that would still exist: a hex color
  expressed without a `#` prefix is not valid CSS, so that specific form
  genuinely cannot occur — this is the only remaining "structurally
  impossible" claim; it is not extended to any other pattern. Cross-check by
  re-running all five patterns against the *fixed* tree at the end; any
  remaining hit outside the documented exclusions above must appear in the
  `flag` residual list, not silently disappear.
- **Nothing wrongly flagged:** a `fix` disposition requires the literal to
  **exactly** equal a scale value (e.g. `16px`/`1rem` → `--space-4`) — no
  tolerance. A near-miss (e.g. `5px`, `7px`) is a real, different value and
  is never silently substituted for a different token's value, since that
  would be an uncontrolled visual change and would violate AC #2 (identical
  render pre/post). Near-misses fall into `flag: no-token`.

### Fix-vs-report-only, and the off-scale residual

Fixing is in scope, bounded to **exact-value** 1:1 substitutions only (see
Verification above) — this is expected to be a **minority** of the >4px
spacing population, not "the vast majority": a full classification pass
found roughly 84-108 on-scale (fixable) values against 120 off-scale values
with no matching token (dominated by `6px`, `10px`, `14px`, `7px`, `5px`),
plus ~75 values ≤4px that are the documented optical-tweak allowance and are
not violations at all. This is a bounded worklist within one PR, not a blind
repo-wide `sed`: each file's diff is a value substitution only, reviewable
line-by-line, with a before/after screenshot check (light + dark) per
touched page/component before it's considered done.

Because the off-scale residual (~120 spacing literals with no matching
token) cannot be closed without adding new tokens — explicitly out of scope
here, and forbidden by the ticket — **AC #1 ("zero literals outside the
documented exceptions") is restated**: this audit closes every violation
**for which a matching token already exists**, and produces a complete,
mechanically-derived enumeration of the remainder (the off-scale residual)
as its deliverable, not a silent gap. The residual is not "the one known
compact-chip case" HEL-680 already describes — it is a materially larger set
(dominated by 6px/10px/14px/7px/5px, ~120 instances), so the PR description
must state this explicitly and flag that HEL-680's stated remit ("the
compact-chip literal") likely needs broadening, or a new follow-up ticket
filed to cover the rest of the off-scale residual — a human decision at PR
review, not something this ticket auto-files.

### Guard test

New `*.css.test.ts` files (or additions to existing ones, matching the
`Modal.css.test.ts`/`inputs.css.test.ts` precedent — read the source of one
of those first) that read each swept CSS file's raw text and assert:
(a) the five grep patterns find **no new** disallowed hits beyond an
explicit, pinned baseline/allowlist of the known off-scale residual
(file + line + value, generated from the final enumeration) — this is the
actual mechanism, since ~120 off-scale literals will legitimately remain in
swept files after this PR and are not "documented exceptions" in the §3
sense; and (b) every `fix`ed literal stays substituted (a plain absence
check for that literal at that location). This must be **demonstrated red**:
temporarily reintroduce one already-fixed literal (e.g. revert one
`padding: 16px` back from `var(--space-4)`) in a swept file, run the new
test, confirm it fails, then revert — captured as evidence in the executor's
report, mirroring the HEL-813 `touchTargetProbe.ts` pattern.

### Guard placement — not HEL-729

HEL-729 ("CI checks: unstyled-BEM-class detector + Modal-footer-prop
enforcement") is a *different* mechanism (a repo-wide CI script à la
`check-schema-drift.mjs`) for a *different* rule pair (unstyled BEM classes,
hand-rolled Modal footers) — unrelated to token literals. This ticket's
guard is a Jest test scoped to the specific files it fixes, following
existing per-file precedent, not a new CI script. No overlap; nothing
redirected to HEL-729.

## Gate-Chain Implications Checklist

Not applicable — this change touches only `frontend/src/**/*.css`,
`frontend/src/**/*.tsx`, and new `*.css.test.ts` test files. It does not
touch `.husky/**` or any script a pre-commit hook invokes.

## Risks / Trade-offs

- **Visual regression risk** from a subtly-wrong token substitution —
  mitigated by the exact-value-only rule (no tolerance; near-misses are
  flagged, never substituted) and per-surface screenshot spot-checks in both
  themes before considering a file done.
- **Guard test scope creep** — kept to exactly the swept files, not a
  repo-wide lint rule (that's HEL-729's lane if ever extended there).

## Migration Plan

No data/schema migration. Pure frontend styling substitution plus new test
files. No backend changes.

## Open Questions

None — ticket is fully scoped; reconciliation with siblings already resolved
during Planning (see `ticket.md`).
