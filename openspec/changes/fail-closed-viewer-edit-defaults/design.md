## Context

See proposal.md (Why). Fail-open defaults found by grep on b2da43a3d (`frontend/src/features/pipelines/ui`):
`canEdit = true` in `spine/PipelineSpine.tsx`, `spine/PipelineSpineHeader.tsx`, `spine/useSpineStepActions.tsx`;
`canRun = true` in `spine/SpineStatusStrip.tsx`, `RunHistoryModal.tsx` (`RunHistoryList`; `RunHistoryModal` forwards an
optional `canRun`); `readOnly = false` in `StepCardFocused.tsx`, `spine/SpineOutputs.tsx`, `spine/SpineSourceCard.tsx`,
`outputEditor/OutputEditorSheet.tsx`, `outputEditor/OutputEditorFooter.tsx`, `outputEditor/OutputSheetPreviewCard.tsx`,
`outputHistory/OutputHistoryModal.tsx`; `isOwner = true` in `StepCardFocused.tsx:29` (flows via `StepOpEditor` to
`UpsertSourceConfig`, where it enables the owner-only "existing dataset" target). `stepCardTypes.ts`'s optional
`readOnly`/`isOwner` are StepCardFocused's own props, defaulted there. Outside `ui/`: `hooks/usePipelineDraftSave.ts:43`
takes an optional `runRole` read as `runRole === "viewer"` (lines 212, 217), so an omitted role allows Save & run; its only
caller (`usePipelineDetailSaveWiring.ts:89`) passes it. The executor re-derives this list with the grep in tasks.md 1.1 before editing; the list
above is a claim, not the contract.

Known caller that relies on the old default: `frontend/src/test/conditionalFormatsEditorHarness.tsx` renders
`<OutputEditorSheet>` without `readOnly`.

The e2e scan (`e2e/hel1794-viewer-read-only.spec.ts` `scan()`) skips any element with `el.closest("fieldset[disabled]")`.
The HTML spec disables only form-associated controls (button, input, select, textarea, ...) inside a disabled fieldset,
and not those inside its first `<legend>`; links, `<summary>`, `[role=button]` elements, draggables and contenteditables
stay live. `<summary>` is not in `SELECTOR` at all.

## Goals / Non-Goals

**Goals:** fail-closed defaults with per-component red-first jest tests; a mutation-proven wider scan; the comment fix.
**Non-Goals:** the panels feature's `usePanelDetailEditState` (proposal Non-goals); changing any viewer/editor-visible
behavior on the real page.

## Decisions

**D1 — default deny, keep the props optional.** `canEdit`/`canRun`/`isOwner` default `false`, `readOnly` defaults `true`.
`isOwner` is owner-vs-editor rather than viewer, but it is the same fail-open pattern in a component this change edits,
and both production callers pass `isOwner={page.isOwner}`, so it is flipped too. The data-layer hook's `runRole` is made required
(D1a): the data-layer hooks already follow the "required role" rule, and its one caller passes it.
Alternative: make each prop required. Rejected: the AC is a runtime property ("omitting the prop yields no edit
control"); a required prop is still omitted through spreads, casts and untyped test renders, and every test render of
these components would have to change. Every production caller is checked to pass the prop explicitly (tasks 1.2); a
caller that does not gets it passed from the role it already has (`canEdit` from the page), never a hardcoded `true`.

**D2 — scan skips by the browser's own `:disabled`.** Replace the `closest("fieldset[disabled]")` skip and the
`.disabled` check with `el.matches(":disabled")`. Alternative: keep the fieldset skip but exempt `a`/`summary`.
Rejected: it would still hide `[role=button]`/draggable/contenteditable elements and misjudge first-legend controls;
`:disabled` is exactly what the browser enforces. Add `summary` to `SELECTOR`.

**D3 — navigational links are told apart by the exact-name allow-list.** The scan does not classify by `href`; a link a
viewer may legitimately follow (e.g. the "Pipelines" crumb today) is accepted only by its exact accessible name in
`ALLOWED`, with a comment naming where it is and why it is read-only. If the wider scan surfaces a link or summary in
a viewer fieldset, the executor classifies it: pure navigation or disclosure (expand/collapse, no write) goes into
`ALLOWED`; anything that edits is a defect to fix. If the classification is a product call, the executor raises an
ESCALATION instead of deciding.

**D4 — the scan's widening is proven by a self-test, not only by a one-off mutation.** A test in the same spec opens the
viewer page, plants an enabled `<a href>` and a `<details><summary>` inside a real disabled fieldset of the page (plus a
plain `<input>` control), runs `scan()`, and asserts the link and summary are reported and the input is not. This is
red against the old scan. Plant and scan inside ONE `page.evaluate` (a React re-render cannot drop the planted nodes in
between), into a visible disabled fieldset under a scan root (desktop `.step-focused__fieldset` inside `main`), with the
input outside the fieldset's first `<legend>`. Mutations recorded: (a) restore the `closest("fieldset[disabled]")` skip → red; (b) drop
`summary` from `SELECTOR` → red.

**D5 — per-component jest tests plus a source guard.** Jest renders each component from the Context list with minimal
props and no role prop and asserts that component's own observable read-only signal: for control components, no
edit/run/owner-only control (by role and accessible name) and disabled configuration fields; for copy-only components
(`RunHistoryList`/`RunHistoryModal` `canRun`, `OutputHistoryModal` and `OutputSheetPreviewCard` `readOnly`), the viewer
copy (e.g. "No runs yet." and not "Run or dry-run this pipeline…"). Each assertion must be shown red with only that
component's default flipped back (no vacuous control-absence test on a component that never renders a control). A guard test greps
`features/pipelines/ui/**/*.{ts,tsx}` (non-test) for a fail-open default (`canEdit = true`, `canRun = true`,
`readOnly = false`, `editable = true`, `isOwner = true`) and also fails on an optional role prop
(`(readOnly|canEdit|canRun|isOwner|runRole)?:`) in a file with no matching fail-closed default; labelled a guard
(its comment states it catches source patterns, not behavior), mutation-proven by reintroducing one of each.

**D6 — comment fix.** `viewerCopy.test.ts`'s header claims to pin "every viewer variant, with the editor/owner string
beside it"; the tests pin one entry's two strings and assert every viewer variant differs from its editor string and
invites no edit/run. Rewrite the comment to say exactly that, including the regex limit (only "add", "edit" and "run the" count as an
edit/run invitation).

## Risks / Trade-offs

- [A caller silently relied on the default] → tasks 1.2 lists every call site with the value it passes; full jest
  suite + the HEL-1794 e2e spec (viewer and editor halves) run green.
- [Wider scan finds a real viewer edit affordance] → that is a defect the scan exists to find; fix it in this change
  if small and on the pipeline page, otherwise escalate.

## Planner Notes

- Self-approved: scope limited to the pipeline detail page (`features/pipelines/ui` plus the one fail-open hook input);
  D1 over required props for components; `isOwner` included (design-gate round 1).
