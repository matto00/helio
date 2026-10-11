## Evaluation Report — Cycle 2 (evaluation-2.md)

- Reviewed HEAD: `81bb621b922a10356c7c4fa1ab18c565486fa1fb`.
- Diff base, re-resolved live: `bc8ccac45160dbd5ddc6a4043bc07055e5c09c39`.
- Cycle-2 delta: `b8ea3ad37..81bb621b9`.
- Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1314/evidence/eval2-*`.

### Phase 1: Spec Review — PASS

- The cycle-2 delta touches only:
  - the import;
  - the summary CSS and class;
  - the grammar doc's known-limitation section;
  - the committed `evaluation-1.md`, which is byte-identical to the persisted copy.
- No behaviour, spec or API change. Cycle 1's Phase 1 findings stand.

### Phase 2: Code Review — PASS

Gates, rerun fresh in WORKTREE_PATH. All green.

| Gate | Result | Transcript |
| --- | --- | --- |
| `npm run lint` | exit 0 | `eval2-static.txt` |
| `npm run format:check` | exit 0 | `eval2-static.txt` |
| `npm run typecheck` | exit 0 | `eval2-static.txt` |
| `check:scala-quality` | clean | `eval2-static.txt` |
| root jest, including helio-mcp | 46 suites, 444 passed | `eval2-jest-full.txt` |
| frontend jest | 518 suites, 5551 passed | `eval2-jest-full.txt` |
| frontend build | exit 0 | `eval2-frontend-build.txt` |
| `sbt testFull` | 6920 passed, 0 failed, 4 canceled, exit 0 | `eval2-backend-testFull.txt` |

- **helio-mcp:** `PASS helio-mcp/src/tools/computeExpressionDescription.test.ts` (`eval2-jest-full.txt:36`).
- **Backend guard:** `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`.

Cycle-1 change requests:

- **CR1: resolved.**
  - `TimestampParsing.scala:3` adds `import java.math.{BigDecimal => JBigDecimal, BigInteger => JBigInteger}`, and lines 71 and 75 match on `JBigInteger`/`JBigDecimal`.
  - A grep of the full branch diff for inline `java.*`/`scala.*`/`spray.*`/`org.apache.*` qualifiers outside imports finds nothing.
- **CR4: resolved.**
  - `docs/compute-expression-grammar.md:212-224` states both gap paths inline.
  - It no longer claims tickets exist and no longer cites an `openspec/changes/...` path.

### Phase 3: UI Review — FAIL

**How I tested.**
- Servers started via `start-servers.sh` on 6746/9653. `assert-phase servers` PASS, and both listeners' cwd is this worktree.
- I used isolated Chromium contexts from the repo's `playwright` library, logged in as `matt@helio.dev`, not the shared MCP browser login. Three contexts:
  - desktop 1440;
  - touch 375, with `hasTouch` and `isMobile`, where `(pointer: coarse)` matches;
  - touch 1100.

**Dev-DB rows.** Created and deleted by exact id. Each delete returned 204; the follow-up GET returns 404 and the source is no longer listed.

| Probe | Pipeline | Source |
| --- | --- | --- |
| UI probe | `d0d5d0b2-21f8-4d96-aba6-515e0fdbd248` | `e793f611-d380-4aa1-bd53-289affde5beb` |
| Tap probe | `5d8e37f3-eb64-414d-9a45-6b0f794a80f5` | `c6d52373-952d-44fd-a7dc-a511563a3960` |

**Servers.** Stopped by exact PID; ports are free.

**CR3: resolved.**
- `::before` is an 8x8 px chevron (`--space-2`) drawn in `currentColor`. It resolves to `--app-text-muted` in both themes: dark `rgb(170,164,156)`, light `rgb(100,94,86)`.
- It rotates from -45deg when closed (pointing right) to 45deg when open (pointing down). The matrices are in `eval2-ui/probe-output.txt`.
- It is visible in `eval2-ui/{dark,light}-{closed,open}-1440.png`.

**Behaviour.**
- Clicking toggles the list open and closed.
- Tab from the Expression input lands on `SUMMARY "Functions"`; Enter opens it and Space closes it.
- A tap opens it on both touch contexts.
- No overflow.
- The only console error is the pre-existing `/schedule` 404 for a pipeline with no schedule.

**CR2: partially resolved, and it introduced a regression.**
- `.tap-expand-44` applies under the touch gate: `position: relative`, an `::after` of 73x44 px with `z-index: 1`.
- An `elementFromPoint` bisect measures the hit region at 44.5 px tall and 75.75 px wide. The 44 px floor is met.
- **But the expander overhang covers the Expression input.** The summary is 28 px tall, so the overhang is 8 px on each side. The gap between the input and the summary is only 4 px:

  | Context | Input bottom | Summary top |
  | --- | --- | --- |
  | 375 | 520 | 524 |
  | 1100 | 516 | 520 |

- As a result, the bottom 4 px of the Expression input belong to the summary's hit region. `elementFromPoint` returns `SUMMARY` at y = 516-519 inside the input box at 375, and at y = 512-515 at 1100.
- **Confirmed with real touch taps** (`eval2-ui/tap-probe-output.txt`):
  - a tap 6 px above the input's bottom edge focuses `compute-expression`, as it should;
  - taps 3 px and 1 px above the bottom edge, still inside the input, focus `SUMMARY` and **open the function list** instead of focusing the input.
- This is the overlap DESIGN.md §3 "Expander tiling" warns about (overlapping hit regions steal taps from the earlier control). The downward overhang is clean: "Available fields" starts at 560/556, exactly where the expander ends.

### Overall: FAIL

### Change Requests

1. **Stop the touch expander from covering the Expression input**
   - Where: `frontend/src/features/pipelines/ui/PipelineDetailPage.css`, the `.pipeline-detail-page__compute-functions` rules around line 2060.
   - Why: the expander overhangs (44 - 28) / 2 = 8 px above the summary, but only 4 px separate it from the Expression input above.
   - Fix: under the same gate, `@media (max-width: 768px), (pointer: coarse)`, give `.pipeline-detail-page__compute-functions` an extra `margin-top: var(--space-1)`. That brings the gap to 8 px, so the overhang ends at the input's bottom edge. Any equivalent that leaves the input's full box hitting the input also works.
   - Verify on a touch context (`hasTouch`/`isMobile`) at 375 and at 1100:
     - `document.elementFromPoint(input.x + 20, input.bottom - 1)` returns the `#compute-expression` input;
     - a tap at that point focuses the input and does not open the list;
     - the summary's bisected hit height is still ≥ 43.75 px.

### Non-blocking Suggestions

- **Carried from cycle 1:** the helio-mcp substring check `${fn}(` passes for a fixture name like `now`, because the doc text contains "no now()". Consider a word-boundary match.
- **Carried from cycle 1:** the summary CSS duplicates `.usage-card__summary`, and `UsageCard` has the same marker and touch-floor gaps. A shared disclosure-summary recipe could be a spinoff.
- **Housekeeping:** the shared MCP browser page from cycle 1 kept appending vite reconnect lines to its console log in `.playwright-mcp/`. I moved that file to `evidence/eval1-ui/console-2026-10-11T10-03-06-084Z.continued.log`.
