## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `c417a2ad04b71ad40eb74dafde40f0c8aa700661`. Base resolved live with `resolve-review-base.sh` as `1b3c309e01080bbca65e246036694dc24b19328d` (exit 0). Commits: 01dab9e5a (plan + red run), e159e4668 (implementation), c417a2ad0 (touch floor + file split).

### What I verified (with evidence)

**Ground truth: the diff.** I read the full non-test diff:
- `deniedPipelinesToast.ts`: N=1 output is unchanged. N>=2 returns `duration: 0` and one `items` row per pipeline, sorted by id. Each row has `linkTo: /pipelines/<encodeURIComponent(id)>`, and `action` only when `p.canRun`.
- `toastsSlice.ts`: adds `ToastListItem`, `Toast.items`, eviction exemption for a toast with rows, and `consumeToastItemAction`. That reducer removes one row's action and dismisses the toast once no row action is left.
- `FormPanelView.tsx`: wires N>=2 to run and then consume. N=1 keeps dismiss-on-run.
- `ToastRowList.tsx`: renders the rows. After a row's run is consumed, focus moves to that row's link.
- `toastFocusHandOff.ts`: non-modal focus hand-off. Focus goes to the element focused before entry, else another toast's control, else `main`.
- `toast.css`: tokens only, plus a touch-gated 44px `::after` expander.
- `store.ts` / `serializableCheckPaths.ts`: adds `payload.items` to the paths the serializability check ignores.

No pipeline-page component and no HEL-1640 file is touched, and there are no backend changes.

**Gates, re-run by me.** I ran `npm ci` first.
- `npx jest --maxWorkers=3` on the changed suites (Toast*, toast.css, toasts slice, deniedPipelinesToast, store, FormPanelView): 10 suites / 146 tests passed, exit 0.
- `npm run typecheck`: exit 0.
- `npm run lint`: no output, which means no warnings.
- Playwright, 2 workers, run on the lane DB `helio_hel1172` with `ANTHROPIC_API_KEY` empty and DEV_PORT=6604: `e2e/hel1172-multi-denial-toast.spec.ts` and `e2e/hel1096-run-to-update-affordance.spec.ts` gave "7 passed (39.3s)".
- I did not re-run the full suite. Evaluation-2 pastes it green, and the full-suite result does not change this verdict.

**Role semantics, owner / editor / viewer, on the live app.** Servers ran on 6604/9511 against `helio_hel1172`. I seeded through the API:
- Owner O has four pipelines, each with 21 no-op `assert` steps (the `steps-above-bound` denial), and a form dashboard.
- Collaborator C has an editor grant on the dashboard, an editor grant on "Editor Pipeline", a viewer grant on "Viewer Pipeline", and no grant on "Hidden Pipeline" or "Zeta...".

Results:
- **C submits.** The accessibility snapshot shows exactly two rows:
  - "Viewer Pipeline": a link to `/pipelines/1fad6d97…` and the reason text, with **no run button**.
  - "Editor Pipeline": a link, the reason text, and a button named "Run to update: Editor Pipeline". Its `aria-describedby` resolves to the reason text.
  - "Hidden" and "Zeta" are not listed.
- I pressed Enter on the editor row's button. A single `POST /api/pipelines/29b0e4a7…/run` returned 200. The toast closed, because no run action was left; the viewer row's link went with it, as Q1 requires. Focus moved to the form's Submit button, not `<body>`. On the repeat, the "Run started." outcome toast appeared about 80 ms later (MutationObserver log).
- **O submits.** Four rows, each with a link and a "Run to update: <name>" button; owner canRun is true for all four. I activated "Editor Pipeline"'s run with focus on the button:
  - focus moved to the "Editor Pipeline" link;
  - that row became link-only and the other three kept their run actions;
  - the toast stayed open.
- **Link.** Clicking the "Hidden Pipeline" row link navigated to `/pipelines/dca567fd…` ("Hidden Pipeline · Data Pipelines · Helio"), and the toast persisted.
- **Persistence.** Opening the command palette moved the toast into the modal, where it survived with its rows intact.
- **Q2, no truncation, scrolling inside the toast.** With 4 rows: `.toast__list` scrollHeight 350, clientHeight 256, `overflow-y: auto`, max-height 256px. Focusing the last control scrolled it fully into view (scrollTop 94). All 4 rows are in the DOM and the AX tree.
- **Console.** No errors during the toast flow. The only error was a pre-existing `GET /api/pipelines/:id/schedule` 404 on the pipeline page, which is unrelated.

**Visual judgment, both themes, 1440 and 390.** I switched theme with the app's own command-palette toggle, not by setting `data-theme`.
- Rows read as a clear hierarchy: a semibold underlined name in the toast text colour, the reason in body text, then the existing accent `.toast__action`. This is consistent with the single-pipeline toast.
- Light and dark are at parity.
- The keyboard focus ring at the scroll edge is fully visible and not clipped.
- At 390px the touch-gated spacing is looser but clean, and the long name wraps correctly.

Screenshots, persisted:
- `/home/matt/Development/helio/.concertino/runs/HEL-1172/evidence/.concertino/scratch/HEL-1172/skeptic/collab-desktop-a.png` — editor/viewer rows, dark, 1440
- `/home/matt/Development/helio/.concertino/runs/HEL-1172/evidence/.concertino/scratch/HEL-1172/skeptic/owner-dark-1440.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1172/evidence/.concertino/scratch/HEL-1172/skeptic/owner-light-1440.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1172/evidence/.concertino/scratch/HEL-1172/skeptic/owner-light-focus.png` — the focus ring on the last link in the scrolled list
- `/home/matt/Development/helio/.concertino/runs/HEL-1172/evidence/.concertino/scratch/HEL-1172/skeptic/owner-light-390-top.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1172/evidence/.concertino/scratch/HEL-1172/skeptic/owner-dark-390.png`

None of my claims depend on mtime ordering. Evaluation-2 discloses no unsound-mtime evidence, so there is no gate defect to record.

**AC trace.**
- AC1, per-pipeline link: `ToastRowList.tsx` `<Link to={item.linkTo}>`, observed live.
- AC1, per-row Run where canRun: the `action` is built only when `canRun` (`deniedPipelinesToast.ts`), observed live for owner, editor and viewer.
- AC1, no toast storm: the message is deterministic and the coalescing is unchanged. Covered by the e2e "rapid identical writes leave one toast", which passed.
- AC2, persistent while it holds actions: `duration: 0` plus the eviction exemption, observed surviving navigation and a modal.
- AC2, keyboard reachable: Tab and the focus hand-off, observed live.
- AC2, computed ARIA: the e2e plus `Toast.items.test.tsx`.
- Owner rulings Q1 and Q2 are both honoured.

**Cleanup.** The two users I seeded were deleted by exact id and email with `buildUserDeleteSql` against `helio_hel1172` (COMMIT). Servers stopped with `stop-servers.sh` (STOPPED ports=6604,9511).

### Verdict: CONFIRM

### Non-blocking notes
- At 390px, the touch-gated `padding-block: var(--space-4)` on `.toast__list` pushes the first row's link about 16px below the warning icon, so the icon no longer lines up with the first line as it does at desktop (see owner-light-390-top.png). This is cosmetic. A follow-up could offset the icon or use padding only at the scroll edges.
- Rows are ordered by pipeline id, not by name, which looks arbitrary to a user (carried over from cycle 1). Sorting by name with id as the tie-break would keep the coalescing key deterministic.
- When the list overflows, the only cue that it scrolls is a row clipped mid-line at the bottom edge. That is acceptable under Q2, but a fade or edge shadow would make scrolling easier to discover.
- `Toast.tsx:161` checks `toast.items !== undefined && hasItems`, which is redundant (also noted in evaluation-2).
