## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Fresh cold agent at HEAD `22f279e1`. Every claim below is from a command I ran, a file I read, or
the running app on DEV_PORT 5880. Prior reports were read as claims only.

**Playwright session sanity:** every request I relied on is `http://localhost:5880/...` (network log
entries 445–484 all on 5880). No 5942 hijack. Page title tracked this branch's app throughout.

---

### What I verified (with evidence)

#### Gates — re-run, not inherited (`npm --prefix frontend`, never root `npm test`)

```
npm --prefix frontend run lint         -> eslint src --max-warnings=0    exit 0
npm --prefix frontend run typecheck    -> tsc --noEmit                   exit 0
npm --prefix frontend run format:check -> "All matched files use Prettier code style!"
npm --prefix frontend test             -> Test Suites: 273 passed, 273 total
                                          Tests: 2804 passed, 2804 total   (27.3s)
```

#### Round 1's CR1 — CLOSED, reproduced against the real defect Output

Confirmed the 4 legacy Outputs still exist live (`GET /api/outputs`, 84 table Outputs; 4 carry
`config.fieldMapping.columns` as a string), including round 1's
`hel904-output-e2ee1b2e-3b59-4334-8988-36e722a3b9bc`.

Re-ran round 1's exact recipe from a fresh page load with a clean console: dashboard
"HEL254WideType overview" → the table panel → click a column header.

- The 400 still happens (root cause is pre-existing and out of scope):
  `[PATCH] /api/outputs/hel904-output-e2ee1b2e-... => [400] Bad Request` (network entry 484).
- **The full console after the click is 5 messages, exactly 1 error:**
  ```
  [ERROR] Failed to load resource: the server responded with a status of 400 (Bad Request)
          @ http://localhost:5880/api/outputs/hel904-output-e2ee1b2e-3b59-4334-8988-36e722a3b9bc:0
  ```
  Round 1's `AxiosError: Request failed with status code 400 at settle(...)` unhandled-rejection
  entry is **gone**. The one remaining line is the browser network stack's own log for a non-2xx
  XHR — emitted before any JS handler runs and not suppressible by application code. This is the
  correct and complete outcome of the fix.
- The on-screen sort stayed applied; no user-visible error surface appeared (ruling 3 honoured).

#### Is the rejection handled on BOTH paths? Yes — structurally, then behaviourally

`grep -n "void updateOutput" TableRenderer.tsx` returns exactly two hits: line 128 (inside a doc
comment) and line 130, the single `.catch`-terminated call inside `persistColumnSort`. The debounced
site (`:266`) and the unmount-flush site (`:237`) both call that one helper — verified in the
`9a4b1998..22f279e1` diff. There is no second code path that could regress independently.

#### Is the regression guard mutation-failable? Yes — I mutated it myself

Removed the `.catch` from `persistColumnSort` and re-ran `--testPathPatterns=TableRenderer`:

```
TableRenderer.test.tsx:134
  [Error: Request failed with status code 400] { isAxiosError: true, response: { status: 400 } }
Node.js v22.23.2
EXITCODE=1
```

The Node process dies on the unhandled rejection — the guard is genuinely failable, and it is
labelled `REGRESSION GUARD (skeptic final-1 CR1) ... mutation-failable` in its own test name.
File restored; `git status --porcelain` shows no modified tracked files.

#### Is the swallow correct rather than hiding something? Yes

Owner ruling 3 is explicit that non-owner/failed writes degrade **silently** to session-local — no
toast, no error surface. A `.catch` that reverted the on-screen sort or surfaced an error would
contradict it. The swallow is confined to one narrow function whose only call is a config PATCH the
user already sees the effect of; it cannot mask a data-correctness failure. The comment explains the
intent, and (per evidence rule 8) I did not take the comment as evidence — the live console and the
mutation run are the evidence.

#### Unmount flush — the path the fix touched, re-verified behaviourally

Sorted `category` on a writable Output, then unmounted the panel **60 ms into the 300 ms debounce**
by switching dashboards. Then read the Output back from the API:

```
GET /api/outputs/hel904-orphan-output-ae5b18b6-... -> 200
config: { "columnSort": { "direction": "asc", "key": "category" } }
```

The flush fired. Then a **full page reload**: the panel re-rendered with `category` at
`aria-sort="ascending"` and the rows actually sorted. The "persists across detail-modal open/close /
page reload" AC holds through the same unmount cleanup the fix modified.

#### Acceptance criteria traced on REAL data (a different Output than either evaluation used)

Output `hel904-orphan-output-ae5b18b6-...` — 1,000-row Sleeper WR probe rows, 76 columns, 200 loaded.

| AC | Evidence |
| --- | --- |
| Click/keyboard sorts every loaded row; second activation reverses | 200 rows reordered; asc→desc verified on `stats.pts_ppr` and `stats.rush_yd` |
| `aria-sort` reflects active column/direction; indicator visible | exactly one non-`none` `th` at a time; live reads `ascending`/`descending`, siblings `none` |
| Persists across modal open/close and page reload | unmount-flush + reload evidence above |
| **Numeric columns sort numerically, not lexically** | `stats.pts_ppr` asc head `3.9, 4, 4.1, 4.1, 4.2` tail `270.5, 280.5, 284.6, 311.1, 312.5`; desc exactly mirrored. Lexical ordering would have put `312.5` before `4` |
| **Blank cells sort last** | `stats.rush_yd` asc tail `—,—,—,—` AND desc tail `—,—,—,—` — blanks last in BOTH directions (D3's `""`→`null` mapping working end to end) |
| No regression to resize / density / column-order | resize handle `role="separator" tabIndex=0`; ArrowRight took the `th` 160px→170px, its own `aria-sort` stayed `none`, and the sorted sibling's `descending` was untouched. Independently operable, fires no sort |
| Jest coverage | 273 suites / 2804 tests, mutation-probed above |
| Visually cohesive, both themes, against the running app | below |

Keyboard: focused the header (`document.activeElement.tagName === "BUTTON"`), **Enter** → `ascending`,
**Space** → `descending`. Native `<button>` semantics, no bespoke key handler.

#### UI cohesion — judged against the running app, both themes

- **Light, active-unhovered** (pointer moved off first): the sorted column is a **filled dark
  up-caret at full opacity**; unsorted columns show a dimmed neutral double-caret. **No accent
  colour in the active state.** This independently confirms the prior reviewers' PR-body correction:
  `--app-accent` is `:hover`-only. My first screenshot showed the label and glyph orange purely
  because the pointer was still on the header I had just clicked.
- **Dark:** same vocabulary — bright filled caret at full opacity vs. dimmed neutral double-caret.
  Legible on the dark header fill; full light/dark parity. No HEL-866/HEL-496 hover collision
  reproduced on this surface.
- **Against the HEL-1022 list tables:** captured `/pipelines` live in dark with `Name` sorted
  ascending. Glyph shape, label-to-glyph gap, neutral dimming and active fill are the same system.
  This is not a lookalike — `DataGrid.tsx` imports `SortableTh.css` and reuses `.sortable-th__btn` /
  `.sortable-th__glyph` / `--neutral` with the same `faSort`/`faSortUp`/`faSortDown` icons and the
  same `aria-sort` vocabulary. The list headers being smaller mono/caps is the pre-existing
  `DataGrid` variant density, not a divergence introduced here.
- **Against the panel's own affordances:** the resize handle and the sort button coexist without
  crowding at default grid panel size, and are independently operable (measured above).
- **The two neighbours do not disagree. No escalation.**
- Tokens: `.panel-content__truncation-note` uses `--text-xs` / `--app-text-muted`; the load-more
  container uses `--space-1` / `--space-2`. No hardcoded values, no new class family, no new token.

#### D9a (the non-owner-approved qualifier)

- **Present only when truncated:** on the 1,000-row Output (200 loaded, `hasMore` true) the note
  renders as "Sort covers only the loaded rows." above "Load more".
- **Absent when fully loaded and on the `rawRows` branch:** the note is inside the
  `usingPagination && paginationHasMore` block; on the HEL254WideType panel (fully loaded) it is not
  in the DOM.
- **No wrap/clip/displacement:** screenshotted at default grid panel size in **both** themes — the
  note sits centered, one line, `--space-1` above the button, no overflow, "Load more" undisplaced.
- Never described as owner-approved: the in-code comment at `TableRenderer.tsx:279-282` and the CSS
  comment both say "NOT part of the owner's sort-mechanism ruling ... deliberately trivially
  removable". Removal is one `<p>` plus one CSS rule.

#### Blast radius / downstream

`grep 'variant="full"'` across non-test `frontend/src`: **`TableRenderer.tsx:274` is the only
consumer.** `sortable` additionally requires `onSort != null`, so no other `DataGrid` caller changes
behaviour, and the `preview` variant is untouched (matches the ticket's out-of-scope list).
`columnSort` lands as a **flat** sibling of `columnOrder` on `TableOutputConfig` — correct given
`OutputService.mergeConfig` only deep-merges four hardcoded chart keys, so HEL-451/465/469 can each
land as their own flat sibling. Not painted into a corner.

#### Test hygiene

The only test change in the fix commit is one **added** guard; `9a4b1998..22f279e1` touches no
existing test or fixture. No fixture was edited to accommodate rather than verify.

---

### Verdict: CONFIRM

Round 1's single change request is closed, verified by reproducing its exact live scenario against
its exact Output and finding the unhandled rejection gone, and by mutating the fix away to prove the
new guard is failable. Both persist paths route through one `.catch`-terminated helper. Every
acceptance criterion traces to behaviour I observed on real data in the running app, on a different
Output than either evaluation used. The affordance reads as the same system as both neighbours in
light and dark. Ships.

### Non-blocking notes (for the PR body)

1. **Carried forward from round 1, still true and still worth stating in the PR body:** `--app-accent`
   is scoped to `:hover` only — the active state is the filled caret + full opacity + `aria-sort`.
   I re-confirmed this independently. The committed comparator screenshots capture the active column
   while hovered and so conflate the two; the PR body wording should say hover-only.
2. `DataGrid`'s `<th>` still does not set `scope="col"` while `SortableTh` does. Pre-existing on
   `DataGrid`, harmless (implicit scope), but now that the two headers are explicitly one affordance
   it is the last gap between them.
3. The spec scenario "Equal values retain loaded order" has no dedicated test.
   `Array.prototype.sort` is spec-stable so the behaviour is real; a two-line test would make the
   scenario non-inherited.
4. Numeric coercion means an integer-like string ID above 2^53, or a leading-zero code like "007",
   can tie or order surprisingly. Inherent to the ruled D3 design; display is unaffected. Worth one
   sentence in HEL-469's (per-column formatting) context, not a change here.
5. "Load more" under an active sort inserts rows mid-list rather than appending. Correct per the
   spec and per what a partial ranking should do — and it is exactly what D9a's note exists to
   explain, which is a further argument for keeping D9a until HEL-1027 lands.
6. Dev-DB residue from my probes (owner-scoped, harmless): `hel904-orphan-output-ae5b18b6-...` now
   carries `columnSort {key:"category",direction:"asc"}`; the HEL254WideType Output was clicked but
   its write 400s, so it is unchanged. No dashboards or panels created.
