## Evaluation Report — Cycle 4 (evaluation-4.md)

Reviewed HEAD `33e4f7f687cdea15a05e815914fd322c2bb2aeef`. The review base was resolved live with
`resolve-review-base.sh` to `968835477e67901a21c5d9fd8d22f7918a6558c3` (origin/main, an ancestor of HEAD).
This is a resumed review. Its scope is the delta since the cycle-3 FAIL (evaluation-3.md, CR1, spec-divergence only),
plus a fresh run of the full gate set.

### Scope of the delta

- `git show --stat 33e4f7f68` touches 3 files, all text:
  - `openspec/specs/chart-panel-truncation-notice/spec.md` (+6/-3)
  - the archived delta `.../specs/chart-panel-truncation-notice/spec.md` (+6/-3)
  - `evaluation-3.md` (new, +169)
- `git diff --stat d9effd22d HEAD -- frontend e2e` is empty. No code or test file changed after the HEAD that cycle 3
  evaluated, so the cycle-3 code, design and UI findings (all PASS) still apply unchanged.

### Phase 1: Spec Review — PASS
CR1 is resolved:
- **(a)** The requirement body now reads "...a chart with neither a footnote nor a viewer-control bar, and the mobile
  stack (HEL-1438) keep their current layout. A chart-output card with a one-control text or dropdown bar lays the bar
  out inline whether or not it shows footnotes."
  - This matches `OutputViewerControlBar.css`: the inline rules key on `.output-viewer-control-bar--chart` plus
    `:only-child:not(--range)` under `(max-height: 260px)`. They do not depend on whether a footnote is present.
- **(b)** The w=2 bullet now covers "a card carrying a footnote, and equally a chart-output card carrying a
  viewer-control bar even when it shows no footnote".
  - This matches `PanelContent.css`: the title/footer clamp selector is
    `:has(.chart-panel__annotation, .chart-panel__truncation-note, .output-viewer-control-bar--chart)` inside the
    `(max-width: 260px) and (max-height: 260px)` query.
- **(c)** Optional, not taken. The "filter empties the result" scenario still asserts only the input position and
  size. This is non-blocking.
- **Both copies match.** The live spec's requirement block (line 69 onward) and the archived delta (line 3 onward)
  were diffed and are byte-identical.
- **CONSTRAINTS.**
  - C1: the hel1398 assertion is now hidden-but-in-the-a11y-tree, citing D3. It is unchanged since cycle 3 and its
    e2e passes.
  - C2: the value-axis unit tests and e2e are present and passing. The OWNER REVIEW screenshots are a PR-time
    obligation. Both constraints are honored.

Issues: none.

### Phase 2: Code Review — PASS
Gates were re-run fresh at HEAD in WORKTREE_PATH (`nice -n 19`, default local caps):

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run format:check` | exit 0 ("All matched files use Prettier code style!") |
| `npm test` | exit 0; 578/578 suites, 6894/6894 tests (plus a 49-suite, 458-test project), 19 snapshots |
| `npm --prefix frontend run build` | exit 0 |

No backend files changed, so `sbt testFull` does not apply. No code changed since cycle 3, so there are no new
code-quality findings.

Issues: none.

### Phase 3: UI Review — PASS
Servers were started with `start-servers.sh` (6876/9783) and `assert-phase.sh servers` printed PASS. They were stopped
with `stop-servers.sh` (STOPPED ports=6876,9783).

- **e2e.** `DEV_PORT=6876 BACKEND_PORT=9783 npx playwright test` ran hel1444, hel1398, hel1305, hel1306, hel1311,
  hel1508 and hel1512. Result: **54 passed (3.2m)**, exit 0. Each spec used its own throwaway `@example.test` users;
  the run reported "deleted 54 recorded throwaway user(s)".
- **Screenshot spot-check.** I compared the 91 files in `.concertino/runs/HEL-1444/evidence/after/` byte for byte
  against the screenshots my own HEAD run just wrote to `e2e-evidence/HEL-1444/`. This is a content comparison, not an
  mtime check.
  - **64 of 91 are byte-identical.**
  - **27 differ by a few bytes to about 240 bytes in PNG size.** I opened the pair with the largest delta,
    `keyed-bare-text-w2.png` (11194 vs 10951 bytes). The two images are visually identical:
    - the title is clamped to two lines with an ellipsis;
    - the lone "REGION" text control is inline;
    - there is no footnote;
    - the footer is on one line.
  - The small deltas are rasterization or encoding noise. None of them is a behaviour difference. The after/ evidence
    reflects HEAD behaviour, and that one image directly shows the newly specified no-footnote, control-bar, w=2 clamp
    case.

Issues: none.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- CR1(c) from cycle 3: optionally add "and the card title stays clamped" to the "a filter that empties the result"
  scenario. This can be folded into the owner-review pass. It is not required.
