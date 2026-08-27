## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Ground truth: worktree HEAD `7ddb4991`, live app at `http://localhost:6256` /
backend `9163` (`assert-phase.sh servers` → `PASS`). Every finding below is
measured geometry (`scrollWidth`/`clientWidth`, `getBoundingClientRect`,
`getComputedStyle`) from the running app plus the raw diff — not from
`evaluation-2.md`, which I read only as a claim.

Note: this worktree's `scripts/concertino/` is missing `emit-event.sh`,
`next-report-number.sh` and `persist-evidence.sh` (only `assert-phase.sh`,
`cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`, `lib`, `README.md` are
present). `start-servers.sh`/`assert-phase.sh` print a
`emit-event.sh: No such file or directory` line as a result but still return
`READY`/`PASS`; I used the main-repo copies of the reporting scripts. Cosmetic,
not a gate failure — flagging it so it isn't mistaken for a real error later.

### What I verified (with evidence)

**Scope of the fix commit.** `git show --stat 7ddb4991` touches only
`frontend/src/features/connectors/**` (5 files) plus two change-dir docs. No
backend, no service, no repository, no schema. The credential contract confirmed
sound in round 1 is therefore untouched by construction; the one credential-file
edit (`ConnectorCredentialField.tsx`) is copy-only — a distinct
`New API key value` / `New bearer token value` label and `Entered once` wording,
no new reveal path. Spot-checked live: the Edit modal still shows `••••••••` +
`Replace credential` + "The credential is never shown after creation", no reveal
affordance (`hel824-r2-edit-modal.png`).

**Change request 1 — mobile stacked layout: FIXED.** At 430px,
`#app-main-content` `scrollWidth 430` === `clientWidth 430` (**0 overflow**;
was 397px). Computed style is now
`{ rowDisplay: "flex", rowFlexDirection: "column", tdDisplay: "block" }` — the
dead-CSS specificity bug is genuinely gone. All six cells measure `top`
147/173/199/223/249/275 at the same `left`, i.e. actually stacked, each 398px
wide inside a 430px viewport. Zero elements under `#app-main-content` extend past
the viewport. Screenshot `hel824-r2-430.png`. 768px re-checked independently:
`scrollWidth 768 === clientWidth 768`, 0 overflowing elements.

**Change request 5 — 1100px: FIXED.** Fresh load at 1100px:
`scrollWidth 860 === clientWidth 860` (**0 overflow**; was 198px), 0 overflowing
descendants, and the first Delete button measures `left 995 / right 1072` —
fully inside the 1100px viewport, `height 44` (the mobile tap floor now applies
here too). 1440px re-checked and still clean (`scrollWidth 1200 === clientWidth
1200`, every Delete at `right 1404 < 1440`). The claimed `PipelineDetailHeader.css`
1100px precedent is real (`PipelineDetailHeader.css:208-210`), and `DESIGN.md:264`
does list 1100 as canonical — the commit message's justification checks out
rather than being asserted.

**Change request 2 — blocked-delete error visibility: FIXED.** To reach the 409
at all I reproduced the *genuine* race (Delete is now disabled up front for
`dependentCount > 0`): loaded the page with `Skeptic Echo Probe` at
`dependentCount 0`, then created a real `rest_api` source referencing it via
`POST /api/sources` (server-side count → 1), then clicked Delete → Confirm in the
UI. That produced a real 409 through the production code path. Measured with the
conflict row rendered:

| Viewport | conflict cell rect | main overflow | overflowing els |
| --- | --- | --- | --- |
| 1440 | `left 264 / right 1416`, h 56 | 0 | 0 |
| 1100 | `left 256 / right 1084`, h 43 | 0 | 0 |
| 430  | `left 16 / right 414`, h 58 | 0 | 0 |

`white-space` on the cell computes to `normal` (was inherited `nowrap`), and the
message renders as its own full-width `colSpan` row beneath the connector's row
(`hel824-r2-conflict-1440.png`). Fully on screen at all three breakpoints.

**Change request 3 — no raw token, count-aware: FIXED.** The rendered text was
`"This connector is now referenced by a dependent source — refresh the page and
try again."` and `/ConnectorHasDependents/.test(document.body.innerText)` →
`false`. That is the *correct* branch for the case I could reach (a stale
client-side count of 0), not the counted one. The counted branch is covered by
tests that would fail if `extractMessage` were still preferred — the mocked 409
body in `connectorsSlice.test.ts` is literally
`{ error: "ConnectorHasDependents: still referenced" }` and the assertion is
`"Still referenced by 3 sources. Repoint or delete them first."`, with a sibling
test for the 0-count fallback and a `ConnectorsPage.test.tsx` test asserting
`queryByText(/ConnectorHasDependents/)` is absent. Non-tautological.

**Change request 4 — false affordance: FIXED.** Measured across all 8 live rows
at 1440px: every row with `dependentCount > 0` has `disabled: true` and
`title: "Remove or repoint the dependent source(s) before deleting this
connector."`; every `dependentCount === 0` row has `disabled: false`, empty
title. No confirm is offered for a delete that cannot succeed, and the row's own
"1 source" / "0 sources" cell is on screen next to it. Visually distinct
(muted) in both themes (`hel824-r2-conflict-1440.png`, `hel824-r2-dark-1440.png`).

**Design judgment.** Light and dark both parity-clean at 1440 — the conflict
banner, the disabled Delete, the `Auto-created` chip and the mono Base URL all
resolve through tokens in both. The CSS diff introduces no new literal values
beyond the DESIGN.md-sanctioned `44px` tap floor and a `1px` border with a
`--app-border-subtle` color; everything else is `--space-*`. The 1100px
stack-to-cards choice is a coarser answer than the column-collapse I suggested,
but it is a recognized responsive-table pattern with in-repo precedent and it
does fix the defect — a preference, not a standard violation (see notes).

**Gates re-run fresh by me**

- `npx tsc --noEmit -p tsconfig.json` → exit 0.
- `npx eslint src/features/connectors --max-warnings=0` → exit 0.
- `npx jest --testPathPatterns="connectors"` → `262 suites / 2868 tests passed`.
- HEL-813 surface 7, run **twice** (flaky in an earlier cycle, so one green is
  not evidence): `2 passed` at 430px and 768px both times — no regression from
  the 768→1100 breakpoint widening.
- No `sbt` gate re-run: the commit touches zero backend files, so there is
  nothing for it to newly certify (round 1's `ConnectorRepositorySpec` green
  still covers the unchanged rotation path).

**Console** — the only errors during my session were from my own deliberate
probe requests (403 CSRF, 400 payload-shape, the intended 409). The app itself
produced none. The `Fragment is not defined` errors visible in the full-history
console log predate my navigation (stale Vite HMR module `?t=1787843491884`
captured mid-edit); the current module imports `Fragment` and the page renders
clean on a fresh load.

**Test-data hygiene** — the two data sources I created to force the race
(`SKEPTIC-R2 race dep`) were deleted afterwards (`204`, `204`), and the
connector's `dependentCount` is back to `0`. The shared dev DB is as I found it.

### Verdict: CONFIRM

All five round-1 change requests are fixed and re-verified with measured
geometry, the fixes are backed by tests that would fail without them, the
credential contract is untouched, and no new defect surfaced at any canonical
breakpoint in either theme.

### Non-blocking notes

- Stacked cells lose their column headers (`thead` is `display: none`), so a
  card reads `rest_api / https://… / Bearer token / 0 sources` with no labels.
  A `data-label` prefix per cell would make the 1100/768/430 layout
  self-describing at near-zero cost.
- At 1100px each card spans the full 828px content width with everything
  left-aligned and the actions right-aligned, leaving a wide dead zone. Capping
  the card content width — or collapsing only the Base URL column — would read
  better than a full stack at what is still a laptop width.
- In the stacked layout the connector name is typographically identical to its
  metadata rows; giving the name `--text-*` emphasis would restore the hierarchy
  the table's NAME column provided.
- `title` on a `disabled` button is inert for touch and largely inert for
  assistive tech — the "remove or repoint the dependents first" reason is
  effectively hover-only. The visible "1 source" cell carries the gist, so this
  is not blocking, but `aria-describedby` pointing at that cell (or a small
  inline hint) would make the reason available to everyone.
- `conflictMessage`'s counted branch is currently unreachable through the UI
  (Delete is disabled whenever the client-side count is > 0), so only the
  stale-count fallback can render in practice. It is correct to keep both, but
  worth knowing that the counted string is test-only today.
- Carried forward from round 1, still open and still non-blocking:
  `ConnectorRepositorySpec`'s rotation test resolves via
  `repo.findByIdInternal` rather than reading `connectorId` back off the
  persisted source row.
