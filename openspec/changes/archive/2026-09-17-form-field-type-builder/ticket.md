# HEL-1084: Field-type builder: the panel config surface

## Description

Author the form: add/remove/reorder fields, pick a type per field, set label, placeholder,
required, and default. Field types map onto the dataset's declared schema — offer the dataset's
fields rather than free-typing names.

**AC:** a form whose fields don't match the bound dataset's schema is surfaced at author time,
not at submit time.

Parent epic: **HEL-1082 — Form panel (with input/counter as its canonical single-field form)**.
A panel that *writes*: field-type builder, render-on-panel, submit appends a row to a bound
`dataset` source. The epic states: "Accessibility acceptance criteria are inline in every leaf
here. [...] this epic introduces the largest batch of new interactive controls in the app's
history and must not create that debt."

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627), §2.

## Acceptance criteria

1. **(Ticket AC)** A form whose fields don't match the bound dataset's declared schema is
   surfaced at author time, not at submit time. "Author time" means BOTH the builder UI (a
   visible, field-associated error the moment the mismatch exists — on open, on dataset switch,
   on field/control choice) AND the config write API (`POST/PATCH /api/panels` rejects the
   inconsistent config with a 400 naming the offending field), so an agent-authored config
   (HEL-1083 D7 path) gets the same author-time answer a human does.
2. The builder offers the bound dataset's **declared fields** (from
   `GET /api/data-sources/:id/schema`) rather than a free-typed `sourceField`, and offers only
   presentation `control`s that fit the chosen field's declared type.
3. The builder supports add / remove / reorder of fields, and per field: control, label,
   placeholder, help text, required (tighten-only — a dataset-required field is shown as
   required and cannot be loosened), initial value ("default" in the ticket = HEL-1083's
   prefill-only `initialValue`), `step` (number control only), and `options` (select only).
4. A `form` panel is **creatable from the dashboard UI**: the add-panel picker offers a Form
   entry that binds a `dataset`-kind source at creation (HEL-1083 D5 makes an unbound form
   panel un-creatable, so the binding step is part of authoring, not optional polish).
5. **(Derived a11y AC — epic statement + DESIGN.md §8, binding for `frontend/**`)** Every
   builder control is keyboard-reachable and completable; reorder is keyboard-operable (not
   drag-only); every control has a programmatic label asserted by **computed accessible name**
   (jsdom presence assertions are vacuous — MISTAKES.md); validation errors are associated
   with their field and announced (`role="alert"` / `aria-describedby`), not only colored.

## Scope boundary (do not build here)

Field rendering on the panel (HEL-1085), file upload semantics (HEL-1086), the submit path and
its row-append validation (HEL-1087), counter chrome (HEL-1088/1089), and the assembled-panel
a11y audit (HEL-1090) stay out. The panel body keeps HEL-1083 D10's neutral "Form not
configured" placeholder. A finding one of those tickets must know is reported, not implemented.

## Orchestrator corrections, verified against the tree at Setup

Full evidence at `.concertino/runs/HEL-1084/evidence/premise-validation.md`. What binds this run:

- **The ticket was in Linear status `Done` with nothing shipped.** It was auto-closed at
  `2026-09-17T23:09:58` by the epic-close cascade when HEL-1082 was set Done 0.45s earlier
  (MISTAKES.md §"Linear: closing an epic cascades"). Re-opened to In Progress by this run.
  HEL-1085/1086/1087/1090 are cascade-closed the same way and are equally unbuilt.
- **Design spec §2's "registration is the only enumeration to change" is FALSE** (tracked by
  HEL-1150). Irrelevant to this ticket's drift surface (no new kind), but do not cite §2 as
  authority for anything enumerative. The authoring-surface sites HEL-1083 design.md explicitly
  DEFERRED to this ticket are `PanelDetailModal.tsx`'s two if-chains (`activeEditorRef`,
  `renderSubtypeEditor`), both currently `return null` for a `form` panel — if-chains, so NOT
  typecheck-protected (HEL-1083 C10).
- **HEL-1083's shipped shape is exactly as the driver described** (`FormPanel.scala`): closed,
  400-enforced attribute set; `control` orthogonal to `DataFieldType`; `required` tighten-only;
  `initialValue` prefill-only; `options` and `initialValue` are untyped `JsValue`/`unknown` on
  the wire. HEL-1083 D3a states: "HEL-1084's author-time check covers field names and
  control-to-type fitness only."
- **No UI path can create a `form` panel today.** `panelService.createPanel`/`createPanel` thunk
  carry no `config`; `OutputPicker.CONTENT_PANEL_KINDS` has no `form`; HEL-1083 D5 rejects an
  empty `dataSourceId`. AC 4 above exists because the builder is otherwise unreachable.
- **HEL-1083 D6 checks the bound source's existence/ownership only, not its kind** — a form
  bound to a `csv` source is accepted today, contradicting the spec's "SHALL bind to a
  `dataset`-kind source". The schema-consistency check closes this as a side effect (a
  non-dataset source has no declared schema; `DataSourceService.getDatasetSchema` already 400s
  on kind).
- **The declared schema is `GET /api/data-sources/:id/schema` (HEL-1122)** →
  `{fields:[{name, type, required, default?}]}`; backend accessor
  `DataSourceRepository.getDeclaredSchema(id, user): Future[Option[Vector[DatasetFieldDeclaration]]]`
  (`DataSourceRepository.scala:875`), frontend `dataSourceService.fetchDatasetSchema`.
- **This leaf has no inline a11y AC** although the epic says every leaf does. AC 5 is derived
  from the epic statement and DESIGN.md §8 (binding regardless); reported as a drafting gap.

## Environment facts verified at Setup

- Every worktree shares one Postgres database; RLS never runs in dev or CI (superuser bypass).
  This change adds NO migration and NO new table.
- `git commit` in this repo runs a Husky chain that routinely exceeds 120s — every commit call
  needs an explicit 600000ms tool timeout; never re-run a commit mid-hook.
- Ports for this run: dev 6516, backend 9423 (from `setup-worktree.sh`; never recompute).
