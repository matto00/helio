## 1. Mechanical enumeration

- [x] 1.1 Run the five widened grep patterns from `design.md` (spacing/font-size
      include `em`/`%`, not just `px`/`rem`) against `frontend/src/**/*.css`
      and `*.tsx`, excluding: `theme/theme.css`, `theme/appearance.ts`,
      `AccentPicker.*`, chart-series-palette modules, `**/*.test.ts(x)`,
      code comments, `MfaEnrollModal.tsx` QR-code colors, and
      `PreferencesEditor.tsx` appearance defaults.
- [x] 1.2 Build a table: file, line, literal, proposed token (exact-match
      only), disposition (`fix` | `flag: no-token` | `flag: optical-tweak-≤4px`).
      Include this table (or a condensed summary with counts by category,
      matching or updating the skeptic-verified baseline: ~84-108 fixable,
      ~120 off-scale flagged, ~75 ≤4px allowed, 0 font-size/weight violations,
      0 real font-family violations) in the executor's final report / PR
      description.

## 2. Fix exact-match substitutions

- [x] 2.1 For every `fix` disposition (exact value match only — no tolerance
      substitutions), replace the literal with `var(--token-name)`.
- [x] 2.2 After each file (or small batch of related files), spot-check
      rendered output in the running dev server, light and dark, for visual
      parity before moving on. Name the concrete touched-surface list here
      once 1.2's table is final (do not narrow silently) — expect it to
      span most `frontend/src/features/**` pages plus shared chrome, given
      the ~84-108 fix count spans many files.

## 3. Guard test(s)

- [x] 3.1 Add `*.css.test.ts` coverage (new files or additions to existing
      ones) for every swept file. Assert: (a) no *new* disallowed hit beyond
      an explicit pinned baseline/allowlist of the known off-scale residual
      (file + line + value, generated from task 1.2's final table), and
      (b) every literal fixed in task 2 stays substituted.
- [x] 3.2 Demonstrate RED: temporarily revert one already-fixed literal back
      to its old value in a swept file, run the new test, confirm failure,
      revert back to green. Capture this as evidence (command + output) in
      the report, mirroring HEL-813's `touchTargetProbe.ts` pattern.

## 4. Verification

- [x] 4.1 Re-run the same five (widened) grep patterns against the final
      tree; confirm every hit outside the exclusion list either was fixed or
      appears in the pinned off-scale baseline — no silent gap.
- [x] 4.2 `npm run lint`, `npm run typecheck`, `npm test` all pass with zero
      new warnings.
- [x] 4.3 Visual regression spot-check (screenshots or Playwright snapshot)
      for every touched page/component (per 2.2's named list), light + dark.
- [x] 4.4 State in the PR description that the off-scale residual (~120
      spacing literals, dominated by 6px/10px/14px/7px/5px) is materially
      larger than HEL-680's stated "one known case" remit, so the human
      reviewer can decide whether to broaden HEL-680 or file a further
      follow-up.
