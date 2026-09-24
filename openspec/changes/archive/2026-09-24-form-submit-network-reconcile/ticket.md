# HEL-1169: Form submit rollback conflates a server rejection with a network failure after commit

## Description

origin_kind: followup
origin_ticket: HEL-1095

The form/counter submit path (from HEL-1087, extended by HEL-1095's optimistic reconcile, merged `c9136b96`, PR #692) rolls back the optimistic value on **either** a server rejection **or** a network failure. A network failure after the server committed (a lost acknowledgement) therefore rolls back a write that actually persisted, so the panel shows an error and a value that disagree with the dataset. HEL-1095's `design.md` Risks section records this as pre-existing and out of scope. The owner's HEL-1095 ruling was "only a failed submit rolls back", and a committed write is not a failed submit.

## Acceptance criteria

* A definite server rejection (4xx/5xx with a body) still rolls back with a visible, associated error (computed `aria-invalid`/`aria-describedby`).
* An indeterminate outcome (network error or timeout with no response) does NOT silently roll back. It reconciles against the authoritative dataset total (the HEL-1095 aggregate endpoint) and shows the true value, with an announced "couldn't confirm" state if the refetch also fails.
* A test drives a lost-ack-after-commit (the server commits, the client sees a network failure) and asserts the final display equals the persisted total, with the red shown against today's behaviour.

## Notes from premise validation (orchestrator, Setup)

* Actual file: `frontend/src/features/panels/ui/form/FormPanelView.tsx` (ticket cited path omits `/form/`).
* Classification rule (resolves driver's premise question 1, already settled by AC #1's own wording): "definite" = an Axios error carrying an HTTP response (`err.response` present) regardless of status code — includes any 4xx/5xx even from a proxy, since it still has a response with a body. "Indeterminate" = no response at all (network error, timeout, aborted, CORS-blocked).
* Today, even a DEFINITE rejection in the compact-counter path never calls `values.setExternalErrors`, so the field never gets computed `aria-invalid`/`aria-describedby` — only the shared alert region's text changes. Building that association is in-scope per AC #1.
* No client-side retry exists (`httpClient.ts` has no retry interceptor). Counter row-append has no idempotency key server-side (`FormSubmission.scala`). A lost-ack-plus-re-click double-count risk is real but PRE-EXISTING and out of this ticket's scope — file as a standalone follow-up, do not widen this ticket to add an idempotency key.
* HEL-1096's `deniedPipelines` toast handling (`pushDenialToastIfAny`) must be preserved untouched on both success and reconcile paths.
* HEL-1170 (separate Low refactor of the same function) is explicitly OUT of scope — do not fold in.
