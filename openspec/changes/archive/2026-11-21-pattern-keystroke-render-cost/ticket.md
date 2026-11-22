# HEL-1809: Pipeline draft: Pattern input handler re-renders the whole page and re-walks the saved step; useScrollEdges costs 13-18 ms on large preview frames

## Description

Follow-up of HEL-1697 (PR #1204, merged 98b8c40e9). Scope extended by the owner on 2026-11-21 with HEL-1808's finding
(PR #1215, merged 6c438a640).

HEL-1697's and HEL-1808's measurements found three main-thread costs while editing a pipeline draft:

1. **Whole-page re-render on each Pattern edit (added from HEL-1808).** Each long task measured by the HEL-1683 regex probe
   was the Pattern field's own synchronous input handler (`DIV#root.oninput`): 41-97 ms of script at 4x-6x CPU throttle in
   the dev build. React re-renders the pipeline page on each keystroke. This is where that probe's margin against its 100 ms
   limit goes. Evidence: `openspec/changes/archive/2026-11-21-regex-probe-control-headroom/attribution.md` and its
   attribution files.
2. **Re-walk on every keystroke.** The saved step is walked again inside the pattern input handler, so each keystroke
   re-evaluates work that has not changed.
3. **Scroll-edge cost.** The draft preview table's `useScrollEdges.ts` costs 13-18 ms per update on large frames (measured on
   a dev build; check the production build).

## Do

- Profile the production build and the dev build. Find what re-renders on a Pattern keystroke and why.
- Narrow it with memoisation, state colocation or selectors, whichever the profile supports.
- Remove the repeated walk, and reduce the `useScrollEdges` cost.
- Keep behaviour the same. Draft preview results must not change.

## Acceptance criteria

- [ ] Before and after profiles show a Pattern keystroke no longer re-renders the whole page and does no repeated walk, and
  the `useScrollEdges` cost is lower on a 1,000-row frame.
- [ ] The HEL-1683 probe's control window, under the HEL-1808 attribution logging, shows a smaller input-handler cost than
  before (state both numbers).
- [ ] The HEL-1683 and HEL-1697 parity corpus and e2e checks still pass.

## Out of scope

- Running the probes on a production build in CI (HEL-1816).
