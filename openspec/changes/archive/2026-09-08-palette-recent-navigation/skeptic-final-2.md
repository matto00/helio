## Skeptic Report — final gate (round 2, skeptic-final-2.md)

### Content self-authentication (before any visual observation)

`curl http://localhost:5951/src/features/commandPalette/model/recentHistoryStore.ts` served
`RECENT_HISTORY_STORAGE_KEY` (3 matches) **and** the round-2 fix inline — `recordVisit(kind, id, title)`,
the `title === undefined || typeof candidate.title === "string" && candidate.title.length > 0` shape
guard, and the conditional entry construction. Port 5951 is serving *this branch at commit `1c075d23`*,
not merely "a palette". All observations below are against that authenticated origin.

### 1. CR1 — verified fixed IN THE RUNNING APP (the defect's actual home)

I drove all three kinds with real resources and real navigation (no `localStorage` seeding of titles):

- Direct-URL arrival at `/sources/c554cc1e-…` → storage gained
  `{"kind":"source","title":"CR9 src"}`. Note this is the **backfill path proven live**: at first effect
  fire the `sources` slice had not loaded, so the entry was written titleless, and the effect re-ran once
  the slice resolved and re-recorded it **with** the title. The self-heal is not just a jsdom claim.
- Direct-URL arrival at `/pipelines/236b13e7-…` → `{"kind":"pipeline","title":"HEL-1022 Multi-source demo"}`.
- **Full browser reload to `/`** (the exact route that failed round 1), 3s settle, Ctrl+K:

  | Group | Options |
  |---|---|
  | **Recent** | `SKF2-82col`, `HEL-1022 Multi-source demo`, `CR9 src` |
  | Navigation | 5 items | 
  | General | 3 items |
  | Create | 4 items |

  **All three kinds render on `/`.** Round 1 measured exactly one row here; this is now three, from a
  completely cold Redux store on a route that never fetches `sources`/`pipelines`. CR1 is resolved.
- Clicking the `CR9 src` Recent row navigated to `/sources/c554cc1e-…` (title `CR9 src · Data Sources`) —
  the rows are functional, not merely present.
- Screenshots (light + dark): `.concertino/runs/HEL-519/evidence/skeptic-final-2-recent-three-kinds-light.png`,
  `skeptic-final-2-palette-dark.png`. `RECENT` eyebrow is typographically identical to
  `NAVIGATION`/`GENERAL`/`CREATE`; per-kind icons (dashboard/workflow/database) sit in the same icon column;
  row height, spacing rhythm and selected-surface treatment match siblings; light and dark are at parity.
  Console errors on the whole sequence: **0**.

### 2. Migration path — verified it does NOT wipe history (with REAL legacy data, not a fixture)

This was the strongest available test and I did not have to construct it: the browser's stored blob at the
start of this round was **already genuinely mixed** — round 1's own recording had written a `dashboard`
entry, and the round-2 code then added `"title":"SKF2-82col"` to it, while the `pipeline` and `source`
entries were still pre-fix, **titleless**:

```
[{"kind":"dashboard","id":"ad203213-…","visitedAt":…,"title":"SKF2-82col"},
 {"kind":"pipeline","id":"236b13e7-…","visitedAt":…},          ← legacy, no title
 {"kind":"source","id":"c554cc1e-…","visitedAt":…}]            ← legacy, no title
```

That blob **loaded successfully** — the dashboard row rendered, proving `loadRecentHistory` did not discard
the whole array over the two missing `title` fields. A legacy entry degrades to the pre-existing
slice-lookup path (`useRecentPaletteActions.ts` `resolveTitle`: `if (entry.title !== undefined) return
entry.title;` then falls through to the collection lookup) and self-heals to a titled entry on the next
visit — which I then watched happen for both. The whole-blob-discard rule is preserved only for a
*malformed* title (`title: 42` → `[]`, asserted at `recentHistoryStore.test.ts`), which is D3's rule
applied consistently rather than a per-field patch-up. **No history-wipe mechanism was reintroduced.**

### 3. D4 — verified untouched; a persisted title is NOT a backdoor

Answering the question directly: **a persisted-title entry whose resource is confirmed deleted is deleted
from history.** `pruneMissing` filters on `entry.kind`/`entry.id` only and never consults `title`, so
persistence changes what *renders* a row, not what *proves* it still exists — exactly as claimed.

Proven live, not just read: I injected
`{"kind":"source","id":"00000000-dead-beef-…","title":"GHOST SOURCE (deleted)"}` into storage.
- On `/` (sources slice never fetched → status stays `idle`) the palette **retained and rendered** it —
  D4's "when in doubt, retain".
- Clicking through to `/sources` (slice transitions to `succeeded`) removed it from `localStorage` within
  2.5s, while the real `CR9 src` entry survived. Prune still fires only on the `→ "succeeded"` transition.

### 4. Nothing newly broken by this cycle

- **Mutation check on the new load-bearing assertion.** I made `recordVisit` ignore its `title` argument
  (`const entry: RecentEntry = { kind, id, visitedAt: Date.now() };`), **verified by grep that the mutation
  landed at line 127**, and ran the palette suites: **6 tests failed across 4 suites**, including the new
  `CommandPalette.test.tsx:437` three-kinds-on-`/` assertion. Strongly discriminating, not an unfailable
  test. Working tree restored and confirmed clean (`git status --porcelain` empty).
- **Gates re-run by me from `frontend/`** (evidence discipline #1 — I did not use root `npm test`):
  `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx eslint src --max-warnings=0` → exit 0;
  `npx jest` → **285 suites / 2901 tests passed**, matching the claim exactly.
- **Motion/token guard still vacuously satisfied:** `git diff 3a0c0fe8...HEAD -- '*.css'` is **0 lines**.
  The change still introduces no CSS; the Recent section continues to reuse HEL-516's chrome.
- The round-2 observer now subscribes to `state.sources.items`/`state.pipelines.items` and includes them in
  its effect deps. I checked this for a re-record loop: `recordVisit` is only reached on a detail-route
  match, and a repeat record with an identical title is idempotent in content (it refreshes `visitedAt` and
  moves an already-first entry to first). Slice identity changes are infrequent (per fetch), not per render.
  No loop observed across four navigations. No new defect here.
- Round 1's own list re-verified as still true: prepend-not-replace holds (13 sibling options intact),
  the null guard is unchanged, HEL-1038 is still the live deferral, and the `ResourceRef`/HEL-503 limitation
  is still disclosed at design.md:52-56.

### Two-axes question

- **What no source text carries:** that the *legacy* migration path is not merely theoretical here — a real
  user mid-upgrade holds a mixed blob whose old entries stay invisible on `/` until they are re-visited
  once. The code is correct and the fallback is deliberate, but nothing in the diff tells a reader that the
  fix is **prospective**: it repairs history recorded from now on, and repairs history recorded earlier only
  on next visit. I hit this myself in the first observation of this round and it is worth one sentence.
- **What path the gates did not exercise:** a **rename**. `recordVisit` overwrites the title on re-visit
  (unit-tested) and prune is id-keyed, so a renamed resource shows its old title in Recent until visited
  again. That is the design's stated trade ("stale beats missing") and is benign, but no e2e drives it. Not
  blocking — it is a correctness-preserving staleness, not a wrong destination: the click still navigates by
  id to the right resource.

### Verdict: CONFIRM

The one blocking defect from round 1 is genuinely fixed at the defect's real site, verified in a running
browser rather than in tests alone; the migration is non-destructive against real legacy data; and D4's
retain/prune contract is measurably unchanged. This ships.

### Non-blocking notes

1. **The chosen trade is not recorded in `design.md`.** Round 1 asked that whichever option was picked be
   recorded there; `git diff d5007858..1c075d23 -- openspec/` shows design.md was not touched. The
   substance is not missing — the rationale, the migration rule and the staleness trade are documented
   thoroughly in-source (`recentHistoryStore.ts`'s `RecentEntry` block, `resolveTitle`'s doc comment, the
   observer's doc comment) and are strictly more precise than a design.md paragraph would be. This is a
   documentation-*location* nit, not a gap in reasoning, and it does not block correct behavior. Worth a
   short "Decision 7 — persist the title at record time" section if the change is revisited.
2. Legacy (pre-fix) entries stay invisible on `/` until re-visited once — see the first axis above. One
   sentence in design.md's Migration Plan would close it.
3. Carried forward from round 1, still true: a full page load re-records the auto-selected dashboard and
   bumps it to the head of the MRU (visible in my own runs — `SKF2-82col` leads even though the pipeline
   was visited later). Defensible; worth a sentence if intentional.
4. HEL-1039 and HEL-1040 confirmed as already-filed and were not re-litigated, per instruction.
