## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `0a260b42b63ac74b48aed7fbcffb7fbbf60440ec`. The diff base was resolved live with `resolve-review-base.sh`, which exited 0: `a606a9833910e36ad544e6aff6e4b87049245559`. The spawn-cwd guard returned `READY`.

Evidence root (persisted): `/home/matt/Development/helio/.concertino/runs/HEL-1352/evidence/openspec/changes/output-history-view-polish/skeptic-final-shots/`. Below, this directory is called `EV/`.

### What I verified (with evidence)

**Diff read in full** (`git diff BASE...HEAD -- frontend`). It touches 9 frontend files and nothing in the backend, schema or API. Each item below matches the change:
- `formatCapturePair` escalates minute → second → millisecond, then falls back to " (older capture)".
- `sameMinute` is removed and has no remaining callers (grep). `chartOverlay.ts:90` and `HistoryScrubber.tsx:17` still call `formatCaptureTime` with minute precision, so their output is unchanged, as design D2 requires.
- `HistorySummary` (header, "vs" caption, metric baseline), `HistoryChart` (overlay label) and `HistoryRows` (notes) all go through the one helper.
- The "No row changes vs …" branch fires only when the diff exists with `noLongerPresent === 0 && changed.size === 0`.
- `.output-history__table` changed from `height` to `max-height: 360px`.
- The History button now uses `--app-radius-sm` and `--weight-medium`, with `font-weight` declared after `font: inherit`.

**Gates, re-run fresh by me** (`nice -n 19`, 3 workers):
- jest on the touched suites (`formatCaptureTime|outputHistory|chartOverlay|OutputGalleryCard`): 8 suites, 90/90 passed.
- eslint `--max-warnings=0` on the touched directories: exit 0.
- `tsc --noEmit`: exit 0.
- prettier `--check`: exit 0.

**The RTL tests go red (my own mutations, in a throwaway detached worktree under the session scratchpad, removed afterwards; `git worktree list` is clean):**
- `formatCapturePair` capped at second precision with no suffix → 4 failures:
  - "tells same-second runs apart…"
  - "marks an identical-instant comparison as the older capture"
  - "labels the rows comparison note with milliseconds…"
  - "labels the chart overlay with milliseconds…"
- "No row changes" branch disabled (`: false`) → 2 failures: "states 'No row changes vs <time>'…" and the same-second rows-note test.
- `max-height` reverted to `height: 360px` → 1 failure: the CSS guard "sizes the rows table to its content".

**AC trace:**
1. *Ghost button per DESIGN.md §5.* `OutputGalleryCard.css:52,57` set radius-sm and weight-medium. In the running app (both themes), `getComputedStyle` gives fontWeight `500`, radius `6px`, height 28px, font size 12px. The hover keeps `--app-surface-raised` rather than §5's literal `--app-surface-soft`. That deviation is justified: the card's own hover is `--app-surface-soft`, so a soft hover would be invisible (HEL-866 class). It is documented in the CSS and design D1.
2. *"No row changes" note.* Covered by RTL tests, and confirmed in the running app. Identical payloads show "No row changes vs Oct 7, 10:31:43.829 AM". A real changed pair shows "1 row from … no longer present", 2 rows flagged and no "No row changes" (`EV/diff-point1-{light,dark}.png`).
3. *Rows-table height.* The note now sits directly under a short table; see C1 below.
4. *Same-second labels.* In the running app, back-to-back runs in the same second show the header "Oct 7, 10:31:43.874 AM" and "vs Oct 7, 10:31:43.829 AM". A same-minute pair (a debounced auto-run arriving about 10s later) escalates only to seconds ("10:37:23 AM" vs "10:37:13 AM"). The minute → second → millisecond escalation works end to end.
5. *RTL tests for the note and the label disambiguation.* Present, and proven red by the mutations above.

**[C1] My own running-app measurements** (lane-private headless Chromium, lane-private beta user, 1440×900), with identical numbers in light and dark:

| Rows | `.output-history__table` | `.ui-data-grid` | Scrolled to bottom | Notes |
|---|---|---|---|---|
| 2 | 157px | 104px (scroll = client) | — | Note top is 8px below the table bottom (`EV/history-small-{light,dark}.png`) |
| 3 | 192px | 139px | — | — |
| 60 (non-virtualised) | 360px | 307px client / 2134px scroll | Last row `r59` sits flush at the scroller bottom | — |
| 400 (virtualised, more than 150) | 360px | 307px client / 14016px scroll | Last row `r399` renders flush at the bottom (lastRowBottom 740.3 vs scrollerBottom 739.9) | 19 windowed rows, no blank spacer gap (`EV/history-big-bottom-{light,dark}.png`) |

C1 holds.

**[C2] My own hovered pixels** (sampled after an 800ms settle):
- Light: button (255,255,255) vs card (239,236,230) → **1.179**.
- Dark: button (35,32,25) vs card (22,21,20) → **1.122**.

Both clear 1.10, so C2 holds (`EV/card-hover-{light,dark}.png`, `EV/card-hover-zoom-{light,dark}.png`). I took these from my own screenshots, not from the executor's `measurements.json`. They do agree with it.

**Visual judgment (both themes):**
- The History button reads as a quiet labelled ghost control, consistent with the card's muted metadata.
- The hover is visibly distinct in both themes.
- The table area now hugs short tables. The muted xs note sits on the same 8px rhythm as the other captions.
- Light and dark have parity.
- No new hardcoded values: 360px was already the existing cap and is now `max-height`.

**Console:** no page errors. The only 4xx responses were `404 /api/pipelines/:id/schedule` for pipelines with no schedule, which is pre-existing behaviour unrelated to this change.

**Test data:**
- Lane-private users, all created and tier-set by exact id via psql (`AND email <> 'matt@helio.dev'`):
  - `36a6f5ee-c06f-4f04-b8b3-0a6eb8107e34`
  - `aac471ef-48bd-44a2-9deb-b9a7c58149c7`
  - `77d391f3-4439-47dd-877c-2514dfa1a707` (an aborted first attempt; its 4 pipeline/source pairs returned 204)
- Every pipeline and source I created was deleted by exact id (all 204).
- One run hit the API rate limit (429) on deletes. I re-logged in after the window and deleted those 4 pipeline/source pairs by exact id (all 204).

### Verdict: CONFIRM

### Non-blocking notes
- `OutputGalleryCard.css` hover comment cites `openspec/changes/output-history-view-polish/screenshots/measurements.json`. Archiving moves that path, so the pointer will dangle unless the archive step rewrites it.
- `formatCapturePair` labels carry no year. Two points exactly one year apart, at the same local time to the millisecond, would get "(older capture)" rather than distinct labels. This is practically unreachable within retention (≤365 days), so no change is needed.
- The metric-baseline "vs" label still has no dedicated same-second test (carried over from the evaluator). It shares `labels.comparison` with the caption, which is tested.
- `measurements.json` has no trailing newline.
