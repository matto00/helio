## Context

See proposal.md — Why. In the compact single-counter layout (`FormPanelView.tsx`, `isCompactCounter` branch),
`handleImmediateStep`'s definite-rejection branch calls both `setAlertText(message)` (the always-mounted
`<p role="alert" class="form-panel-view__alert">`) and `values.setExternalErrors({ [field]: message })`, which makes
`FormFieldControl` → `FormField` mount `<p role="alert" class="ui-form-field__error">` with the same text and point the
spinbutton's `aria-describedby` at it. Two alert nodes, one message.

## Goals / Non-Goals

Goals: one rendering and one announcement of a compact counter's rejection; the control stays invalid and described
by the message; live regions stay mounted (HEL-1804).

Non-Goals: the multi-field form (unchanged; HEL-1819 queued); the indeterminate "couldn't confirm" path (only ever
used the form alert); the compact layout's CSS (HEL-1804's `:empty` rule untouched; HEL-1618 queued); the global
toast region; `e2e/hel1791-compact-counter-stack-height.spec.ts` (HEL-1826 owns it — must not be edited).

## Decisions

**D1 — The form alert carries it (owner ruling `form-alert-B`, escalation answered 2026-11-22).** Alternative A
(field error carries it, alert stays empty) was rejected: `FormField`'s error paragraph is mounted together with its
text, so the announcement would rely on a freshly inserted alert node rather than a region that existed before the
submit (the `form-panel-submit` spec's "live regions exist before any submit"), a repeated identical rejection would
need an extra clear, and hel1791 (owned by HEL-1826) asserts the alert fills on a 400. Both styles are identical
(`--text-xs`, `--app-error`), so there is no visual cost.

**D2 — Mechanism: an optional external-description id on `FormFieldControl`.** Add an optional prop (name it e.g.
`errorDescriptionId?: string`). When it is set and `error` is non-null: `FormField` receives no error (so it renders no
error paragraph), the control stays `invalid` (`aria-invalid="true"`), and its `aria-describedby` base id is the
external id instead of the field's own `errorId` (the `tallyCaption` id is still appended after it, unchanged). When
`error` is null the prop has no effect (hint/caption behaviour unchanged). The compact branch gives the alert `<p>` a
stable `useId()` id and passes it. The `values.errors` state, `setExternalErrors` calls, and their clear-on-success /
not-cleared-by-reconciliation semantics are unchanged — only where the text renders moves. Alternative considered:
dropping `setExternalErrors` in the compact branch — rejected, it would lose `aria-invalid` and the spec's
field-association.

**D3 — Hint while invalid.** With `error` withheld from `FormField`, a counter `helpText` hint, if configured, stays
visible under the control while the message shows in the alert; the control's description is the alert (not the hint),
matching today's "error replaces hint" description. Acceptable and noted.

**D4 — Multi-field form unchanged.** It shows a form-level summary that can name several fields (including ones the
form doesn't render) plus each control's own error — the standard error-summary pattern; the summary is not a pure
duplicate there. Changing it belongs to HEL-1819.

## Risks / Trade-offs

- [In-flight empty description] The alert is emptied (flushSync) at the start of every step while `externalErrors`
  is only cleared on success, so while a later click is in flight a still-invalid control's description is briefly
  empty (today the field error text stays visible then). → Accepted by the owner; record it in the PR body.
- [Indeterminate after rejection] If an indeterminate settle later writes "Couldn't confirm…" into the alert while the
  field is still invalid, the control's description is that text. → It is the current, accurate message; no change.
- [Existing tests assert the field error] jest tests that look for `.ui-form-field__error`/field error text on the
  compact counter must be updated to the new contract, with the reason stated, never loosened.

## Migration Plan

None — frontend only, no data or API change.
