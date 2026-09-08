# HEL-516: Quick-create actions from the command palette

## Description

Creating resources today requires navigating to the right section and clicking its create button. The command palette should offer these as first-class "Create …" actions so authoring starts from the keyboard.

## Premise corrections (Setup, CON-136 — verdict `minor-staleness`)

The goal is intact and genuinely undone, but four of the ticket's factual claims are stale and two discoveries materially reshape the design. **All of these are binding on the plan.**

1. **The four creation seams ALREADY EXIST — consume them, never re-implement dispatch.** HEL-548 (D5/D5b) shipped `useCreateDashboardAction`, `useAddSourceAction`, `useCreatePipelineAction`, `useCreatePanelAction`, each with its own test file, each returning `CreateActionResult { cta: EmptyStateCta; error: string | null; isPending: boolean }`. The dispatch half of every AC is already solved. Re-implementing it would duplicate creation paths, which this ticket's own AC forbids. **If a seam's shape does not fit the palette call site, EXTEND the seam — do not fork it** (HEL-510 already shipped a frozen API that could not express a call site its own tasks required; do not repeat that).
2. **REACH is the actual deliverable, not registration.** Only `CreatePipelineModal` is mounted at the app shell (`App.tsx:209`) and works from any route. `AddSourceModal` is mounted only by `SourcesPage` (`/sources`); `OutputPicker` only by `PanelList` (`/`). Both seams' docstrings say so ("usable only from there today"). **Three actions that silently no-op off-route are a WORSE outcome than three actions that do not exist**, because the palette would advertise capability it does not have.
3. **`PanelCreationModal` does not exist.** The rendered component is `OutputPicker` (`PanelList.tsx:315-320`), gated on `panelsSlice.panelCreationModalOpen` AND a required non-null `dashboardId` prop. The name survives only as the Redux field `panelCreationModalOpen`.
4. **"New Dashboard in `DashboardList`" is not a modal.** It is an inline local-`useState` form (`isCreateMode` + name field). Separately, `useCreateDashboardAction` performs an *immediate* create of "Untitled dashboard" via the `createDashboard` thunk — a deliberately different flow that HEL-548 D5 chose not to collapse with the named-create form. The palette should use the immediate-create seam; it needs no mounted host at all.
5. **`OverlayProvider`/`useOverlay` cannot open a modal** — it only coordinates already-rendered overlays via a single `activeId`. Re-verified independently during HEL-510. `shareDialogContext` is the only real "open from anywhere" precedent, and is scoped to one dialog.
6. **`CommandAction` has no field for a shortcut combo** (`types.ts:7-31`), so the palette currently has nothing to feed a `KeyCap` from.

## Acceptance criteria

* Palette lists Create actions for dashboard/source/pipeline/panel; running each opens the same creation flow the section button uses (**no duplicated creation logic** — the HEL-548 seams are consumed).
* New panel is unavailable when there is no selected dashboard; others always available.
* **Every create action works from a route where its host component is NOT mounted.** This is the ticket's hardest requirement. A test that exercises an action from the route where the component already lives proves nothing about reach and does not satisfy this criterion.
* Running a create action closes the palette and focuses the opened modal (DESIGN.md §8 focus management); created resource matches the normal flow.
* Actions styled via tokens + `.eyebrow` group; correct in light/dark. Tests for action availability + dispatch/opening; `npm run lint` / `npm test` pass, zero new warnings.
* **KeyCap in the palette (owner ruling, folded in from HEL-510).** `KeyCap` currently renders only in the help overlay, so the palette shows no caps for its own shortcut-bearing actions — a cohesion gap the owner ruled must be closed here rather than filed as a follow-up. `CommandAction` gains an optional field able to carry a shortcut combo, and the palette renders it via the existing `shared/ui/KeyCap` primitive. Do NOT build a second cap component or re-declare cap styling.

## Out of scope

* Redesigning the underlying creation modals (HEL-347's creation ticket).
* Inline creation without the existing modal.
* **HEL-1028** (layout undo/redo never visually reverts) and **HEL-1029** (`Modal` heading focus ring) — filed, pre-existing, explicitly not absorbed here.

## Lane / collision context

Lane B, second of four (HEL-510 done → **HEL-516** → HEL-519 → HEL-503, epic HEL-348). Base `db51e936` includes my own HEL-510 (shortcut registry, `shared/ui/KeyCap`, `HelpOverlay`) and `0638f749` HEL-1014 (react-grid-layout 2.2.4 + jsdom width-shim repair — relevant because `PanelList`/`OutputPicker` tests run under that shim). Lane A is on table panels (`HEL-448`); `HEL-1015` is active on backend JSON flattening. Neither touches `features/commandPalette/**` or the create seams. Stay inside the palette, the create seams, and app-shell mounting.

## Evidence discipline (binding on executor, evaluator, skeptic)

1. **A green gate is not evidence until you check what it actually scans.** Root `npm test` is `jest --passWithNoTests && npm --prefix frontend test` — inside a worktree root jest finds zero tests and turns silence into a pass. **Run gates from `frontend/`.** `check:no-credential-leak` only scans `frontend/src/features/assistant/**`; `check-schema-drift.mjs` only reads `schemas/**`.
2. **Hand-built fixtures find nothing; real data finds real defects.**
3. **jsdom proves nothing about focus, visibility, or computed style** (HEL-1005). HEL-510 shipped a visible 40px misalignment past lint, typecheck, 2801 unit tests and 6/6 Playwright cases because the bad spacing was *inherited from UA defaults and never written* — invisible to every source-text check and to jsdom. Prove focus/visual behavior in a real browser.
4. **A deferral is only real if it names a task that exists and a ticket that owns it.**
5. **"No wire impact" != "no downstream impact."** HEL-519 and HEL-503 inherit whatever `CommandAction` shape ships here.

**State what each guard actually proves and what it cannot.** HEL-510 caught three separate guards claiming coverage they did not have. Its single best call was a *refusal* to add a test that structurally could not fail. A proof test must be red before the fix; a regression guard need not be, but must be failable by mutation and labelled as such. A fixture edited to make tests pass is a defect symptom.

**Screenshots go to `.concertino/runs/HEL-516/evidence/` — full stop.** `.gitignore:42` ignores `*.png` globally and `:87` ignores `.concertino/`, so that path is safe by construction. Never write evidence into `openspec/**`; never `git add -f` past the ignore.

## Binding standards

`CONTRIBUTING.md`, `DESIGN.md` (frontend work), and `.concertino/laws/`.
