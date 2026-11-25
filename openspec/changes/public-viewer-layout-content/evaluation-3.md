## Evaluation Report — Cycle 3 (evaluation-3.md)

This cycle reviews HEAD `53ee75d9868b01cfd27e5f85f01c0b0fc5ee84e8`. The cycle-3 changes are `6e580521f..53ee75d98`; the review base is `95cec30cf`, resolved live.

The spawn-cwd guard passed (READY). I ran every gate below myself, under the lane constraints:
- lane DB `helio_hel1587`;
- `ANTHROPIC_API_KEY` empty;
- jest capped at 3 workers, Playwright at 2.

Afterwards I stopped my servers and deleted my throwaway user by its exact id.

The untracked `skeptic-final-2.md` in the change dir belongs to the skeptic. I did not review it.

Evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1587/evidence/.concertino/scratch/HEL-1587/`. Below, `<ev>` stands for it.

### Gates (fresh)

| Gate | Result |
| --- | --- |
| `npm ci` (frontend) | exit 0 |
| `npm run lint` / `format:check` / `typecheck` / `check:schemas` | all exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| jest, changed areas: `src/features/dashboards/`, provenance, `MobilePanelStack`, `panelGridConfig`, `FormFieldControl` | 102 suites / 859 tests pass |
| `npm test` (full) | root: 76 suites / 683 tests; frontend: 951 suites / 11,075 tests (+2 new); all pass |
| Playwright (dev): `hel1587-public-viewer-layout` + `hel1744-insight-panel` | 7/7 passed |

This cycle changes no backend code. My cycle-2 backend shard (436 tests) still stands.

### Phase 1: Spec Review — PASS

Both changes answer `skeptic-final-1.md`, and both fall inside the ticket's scope.

**Phone stack order.** The stack now follows the stored xs layout.
- It uses `orderPanelsForMobileStack(panels, resolveDashboardLayout(panels, layout).xs)`. The signed-in `MobilePanelStack.tsx:153` calls the same helper with the same resolved xs.
- The ordering is therefore shared code, not a copy.
- This resolves the cycle-1/2 non-blocking note about API order.

**Provenance trigger.** The output panel's trigger moved from a row of its own into the card's title row (`PublicPanelTitleRow`).
- It applies in both the grid (an `h2` title) and the stack (a `span` title).
- Only output panels get the trigger.
- The old `.public-dashboard-viewer__provenance-row` is removed. No reference to it remains, so there is no dead CSS.

### Phase 2: Code Review — PASS

**Red-first evidence for both changes** is in `red-run-cycle3-frontend.txt` (2 failed, 14 passed). Both failures are assertion failures, not compile errors:

| Test | Failure |
| --- | --- |
| "orders the phone stack by the stored xs layout" | deep-equality mismatch: the stack rendered in API order |
| "puts the output panel's provenance trigger beside its title" | `Expected: "Sales"`, `Received: undefined`: no title row existed |

The same red is summarised under CYCLE 3 in `mutation-evidence.txt`.

**Test strength.** The new tests are meaningful.
- The order test feeds API order (markdown, image, output) against an xs layout that reads output, markdown, image.
- The title-row test checks three things: the trigger is inside the title row; it is not inside the `h2`; and non-output panels have no trigger. It does this in both the grid and the stack.
- The e2e now asserts the stack order and the trigger's placement in the title row, in both themes.

**Code quality.**
- `PublicPanelTitleRow` is small and typed.
- The CSS uses tokens only (`--space-2`).
- No FQNs, casts or dead code.

**Non-blocking nit.** The import order in `PublicDashboardViewerPage.tsx` has `../state/dashboardLayout` between two `./` imports. It is cosmetic, and lint and format both pass.

### Phase 3: UI Review — PASS

I seeded an output, a markdown panel and an image. The API returns them newest-first; the xs layout order is output, markdown, image.

**At 375 px**
- The stack reads Orders, Story, Photo, matching xs order.
- The provenance button sits at the trailing end of the Orders title row.
- No grid is rendered.
- Screenshot: `<ev>/eval3-public-375.png`.

**At 1440 px**
- The grid renders two columns at md.
- The trigger is right-aligned in the Orders card's title row, on the same line as the `h2`. The body no longer has an empty trigger row above the table.
- Screenshot: `<ev>/eval3-public-1440.png`.

**Resizing from 375 to 1440 px**
- The first capture after the resize still showed the stack. That frame came before the ResizeObserver callback had swapped the view.
- A re-check about 1 s later found the grid and no stack. This is the expected asynchronous resize, not a defect.

**Console:** no errors or warnings.

**Left to the skeptic:** visual cohesion against the signed-in card is a [judgment] call, and the skeptic has confirmed this head.

### Overall: PASS

### Non-blocking Suggestions

- Move the `../state/dashboardLayout` import above the `./` imports in `PublicDashboardViewerPage.tsx`.
- Still owed at Delivery: the public `config.dataSourceId` exposure follow-up, and the shared `ImagePanel` empty-state copy ("Open panel settings…") shown to anonymous viewers.
