## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD d305ab95cb53e387c4b548ea6601856f0aecf6cf against the live-resolved base beb94adfe49759ebc8e180500130a032fdfac3b4 (origin/main).

### Phase 1: Spec Review — PASS
Issues: none.
- AC1 (one bar per line at 431-604px, light and dark, skeleton look): the span `ui-skeleton home-opening__ghost-bar` inside the hidden ghost (`HomeOpeningLine.tsx:39-41`) plus the inline/clone/mask rule (`HomePage.css:83-157`). The e2e pins 2 fragments at 431 and 604 and checks thickness, gap and corners. I re-ran it: 44/44 passed.
- AC2 (hel1665 0px series and the HEL-1737 sweep): I re-ran all four hel1665 files (90 passed), plus hel1678 and hel1572 (19 passed). I did not re-run the container sweep (`sweep-{ci,dv}.out`, zero of 981 differing at head and on base). It is corroborated by the host 0px series and by the change being paint-only: an inline span with no padding, border or margin.
- C1 red first: the red commit 55fb1bc36 (19:53) predates the implementation commit d305ab95c (20:25). 55fb1bc36 touches no implementation file: `git diff beb94adfe 55fb1bc36` on HomePage.css and HomeOpeningLine.tsx is 0 lines. red-base.txt shows 44 failed, and red-unit.txt shows 4 failed.
- Spec edits between the red and green commits: reduced motion was added to the geometry tests, with a stated reason (in light, the shimmer gradient passes through the page-background colour, so a pixel scan cannot see it). An 800ms settle and a scoped `ghostRule` calc check were also added. These are not weakenings: the shimmer itself is still asserted in the computed-style test (`animationName === "ui-skeleton-shimmer"`, gradient background) at every width.
- C3: Skeleton.tsx and Skeleton.css are unchanged (`git diff --quiet`), there is no JS line counting, and there is no shimmer outside Skeleton.css (a unit assertion pins this).
- HEL-1584 `tl-nudge` is untouched: its keyframes block is byte-identical to base, and it is still the only `@keyframes` in HomePage.css.
- C4: the targets are met (16px at 20px size and 19px at 24px, gaps of 9px and 11px, `--app-radius-sm` corners), with no change to line-height or font-size.
- The tasks are all marked done and match the diff, and the spec delta matches D2/D3. There is no API or schema impact and no scope creep.

### Phase 2: Code Review — PASS
I ran the gates fresh in WORKTREE_PATH:
- `npm run lint` passed.
- `npm run format:check` passed.
- `npm run typecheck` passed.
- `npm --prefix frontend run build` passed.
- `npm test` passed: root 617/617 and frontend 10305/10305, at 3 workers.

Mutations: I re-ran them independently, without touching source. A scratch copy of the full spec injects a `!important` override style, and a control run with no mutation passed 44/44.
- (a) `box-decoration-break: slice`: 40 failed and 4 passed. The 4 that pass are the one-line widths, as expected. The failures come from the "top-left corner pixel" check and the computed clone check.
- (b) `visibility: hidden`: 44 failed ("one painted bar per fragment per column, got [[],...]" plus the computed visibility check).
- (c) `mask-image: none`: 44 failed ("thickness 29", mask-image none).
- (d) Absolute bar: this is the base markup, already shown red by red-base.txt (44 failed).

All counts match the executor's `mutations.txt`. Evidence:
- `/home/matt/Development/helio/.concertino/runs/HEL-1749/evidence/.concertino/scratch/HEL-1749/eval/mut/{control,a-slice,b-hidden,c-nomask}.txt`

Other code checks:
- Mechanical standards: no hardcoded colours. The radius is `var(--app-radius-sm)`, and background, animation and reduced-motion come from `.ui-skeleton`. The direct `Skeleton.css` import is commented and pinned by a unit test.
- Type safety, security and error handling: not applicable here (markup and CSS only).

### Phase 3: UI Review — PASS
- The happy path works. Bars are drawn per line in light and dark (the e2e re-run covers 320-1280, Serif/Mono, reduced motion via OS and via `data-motion="off"`).
- Live visual check against the sibling skeletons: with home-summary, dashboards and pipelines held, the opening-line bars use the same tint, shimmer and radius as the dashboard-shelf, runs and Needs-attention skeletons, in both themes. Evidence:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1749/evidence/.concertino/scratch/HEL-1749/eval/mut/visual-light-500.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1749/evidence/.concertino/scratch/HEL-1749/eval/mut/visual-dark-500.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1749/evidence/.concertino/scratch/HEL-1749/eval/mut/visual-light-1280.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1749/evidence/.concertino/scratch/HEL-1749/eval/mut/visual-dark-1280.png`
- Accessibility is unchanged: the ghost is `aria-hidden`, and the wrapper has `role=status` with "Loading summary". There are no new interactive elements.
- Breakpoints 320-1280 render without layout change (0px series green).
- Console errors were not separately captured. The change has no JS logic (one span replaces one component), and the e2e flows passed without page errors.
- Judgment on the visual design is left to the skeptic.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- DRY in `HomePage.css:92-156`: the six-layer mask is written twice (`-webkit-mask-*` and `mask-*`, about 60 lines). A custom property such as `--ghost-bar-mask` used by both, plus a `--bar-h: 0.8em` in place of the bare `0.4em` / `0.8em` literals, would halve the rule and tie the half-height to the height.
- HomePage.css is 934 lines, well past CONTRIBUTING's ~400-line "propose a split" mark (it was already over before this change). Mention a split in the PR description.
- My visual-capture scratch spec was first written with an unquoted heredoc. The backticks were escaped, so nothing was executed, and the file was rewritten with the Write tool. This is a process note only, for the record against the quoted-heredoc lane rule.
