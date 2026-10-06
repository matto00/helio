## Standing Constraints

## 1. Baseline measurement (before)

- [x] 1.1 In the running app (ports 6695/9602, own headless context, own throwaway user), seed one line, bar, scatter and pie panel. Record every created id in `evidence-ids.md`. Verify the ids are listed.
- [x] 1.2 Measure the painted axis-label, axis-name, legend and pie slice-label colour vs background (zrender `style.fill` plus a canvas pixel sample) and the WCAG ratio, in light and dark. Verify by saving `measure-before.md` and screenshots `before-{light,dark}.png` in the change dir.

## 2. Frontend

- [x] 2.1 Add `resolveChartTextColor(theme, appearance, liveTextToken)` to `theme/appearance.ts` per design D2. Verify `npm run typecheck`.
- [x] 2.2 Add a required `theme` to `BuildChartOptionParams`. Pass it from `useChartOption`. Replace every `appearance?.color` text use in `buildChartOption` with the D2 result. Verify typecheck and lint.

## 3. Tests

- [x] 3.1 Add `buildChartOption` unit tests (D6: inherit/absent/empty → token for line, bar, scatter and pie; explicit hex passthrough; tinted flip; pie asserts textStyle and legend; compact path keeps the colour; explicit hex unchanged even on a tinted surface). Show them RED against main's `buildChartOption.ts`, with the transcript saved as `red-first.txt`.
- [x] 3.2 Show the same tests GREEN after 2.x, then show a mutation that restores `appearance?.color` turning them red, with the transcript saved as `mutation.txt`.
- [x] 3.3 Add a palette `defaultText` == theme.css `--app-text` (both themes) assertion if no existing guard covers it. Verify it fails when one value is altered.
- [x] 3.4 Re-measure as in 1.2 after the change, plus one dark tinted-background panel. Save `measure-after.md` and `after-{light,dark}.png`, and add a before → after section (SC 1.4.3 AA 4.5:1) to `docs/contrast-audit.md`.
- [x] 3.5 Delete the seeded rows and user by exact recorded id. Verify by re-query, and record the residue status in `evidence-ids.md`.
- [x] 3.6 Report honestly in the audit and PR: if 1.2 shows the colour already passed in some theme or kind, say so and do not claim a before-fail. Verify with the `measure-before.md` cross-reference.
- [x] 3.7 Run the full frontend gates (lint, typecheck, format:check, jest) green, with the transcript saved as `gates.txt`.
