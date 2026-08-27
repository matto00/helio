# HEL-827: REST source form parity: the UI can currently author less than an agent can

## Description

Child 6 of HEL-820 (epic: Connectors — reusable credentialed hosts, parameterized sources). Depends on children 3 and 4 (HEL-823, HEL-824).

Bring the human REST-source authoring surface (`frontend/src/features/sources/ui/forms/RestApiForm.tsx` + `AddSourceModal.tsx`) to parity with — and past — the agent/MCP surface, against the post-HEL-826 model. Auth is no longer a form field; it belongs to the Connector. The form must make Connector selection legible so the absence of an auth field reads as correct, not missing.

**PREMISE NOTE (orchestrator premise-validation, see `.concertino/runs/HEL-827/evidence/premise-validation.md`):** the ticket's "the form exposes only two fields, method hardcoded GET" framing is STALE — HEL-826 already shipped a method selector, body/content-type editor, and `rootSelector` (renamed from `jsonPath`). The real remaining gap, confirmed against the live tree at main `f73cee3a`: no Connector picker/inline-create, no `queryParams` field, no per-source `headers` field, no template `parameters` (HEL-823) editor, and the dual-support bare-`url` create path (HEL-822) is still the only way to create a source from the UI.

## Scope (restated against verified current state)

* Pick a Connector (or create one inline via `ConnectorCredentialField`, HEL-824's reusable primitive — evaluate fit before building anything new), then return to the form
* Endpoint path, method (already exists), query params (new)
* Per-source headers (new — client type already declares `headers`, unrendered)
* Request body / content type (already exists, HEL-826 — reuse, don't rebuild)
* `rootSelector` (already exists, HEL-826 — reuse, don't rebuild)
* Template parameters (HEL-823's `{{name}}` map) with their values (new)
* Test-before-save, reusing the existing `TestConnectionAffordance`, against the composed request (Connector + endpoint + params + body)
* Retire the dual-support bare-`url` create path from the UI (HEL-822 owns dual-support's existence; this ticket owns retiring it) — must not break/orphan existing implicitly-created Connectors/sources. Decide explicitly whether "retirement" means removing backend bare-`url` acceptance or only ceasing to emit it from the UI while the backend still accepts it (relevant: HEL-828/MCP surface may still rely on bare-`url`) — this is a product call; escalate if genuinely ambiguous.

## Why High priority

This is the ticket that actually resolves the stated pain — children 0-5 built the model, this is where a user feels it.

## Design constraints

`DESIGN.md` binding. Use shared primitives (reuse `ConnectorCredentialField`, `TextField`, `Textarea`, `Select`, `TestConnectionAffordance`). Watch `CONTRIBUTING.md` file-size budget — split deliberately rather than letting `RestApiForm.tsx`/`AddSourceModal.tsx` sprawl.

Mobile: covered by HEL-813's touch-target sweep at 430px and 768px (all four DESIGN.md breakpoints — 430/768/1100/1440 — must be checked regardless).

## Security contract (unchanged, terminates in this UI)

Raw credential never returned by any read path, never logged, decrypted only at the outbound call. If the form creates a Connector inline, it inherits HEL-824's shown-exactly-once contract: no reveal, editing cannot show the existing secret, rotation means re-entry.

## Acceptance criteria

- [ ] A user can author, from the UI, every REST source shape the MCP tool can produce — enumerate both surfaces (current form fields vs. MCP `create_rest_data_source` + current `RestApiConfigPayload`/`RestApiConfigBody`) and show parity explicitly, in both directions, in the design doc
- [ ] Connector selection is clear, and the absence of auth fields is explained in the UI rather than looking broken
- [ ] Test-before-save works against the composed request (Connector + endpoint + params + body)
- [ ] Template parameters are editable with their values
- [ ] Covered by the touch-target sweep at 430px and 768px (and verified at 1100/1440 per DESIGN.md)
- [ ] Built from shared primitives; DESIGN.md tokens throughout
- [ ] Retirement of the dual-support bare-url create path does not break/orphan any existing implicitly-created source (prove one still fetches after the change)

## Out of scope

MCP-side changes (child 7, HEL-828).

## Known, deliberately deferred (do not absorb, do not regress)

- `splitUrl`/query-merge collapsing duplicate query keys (needs an ordered multi-map) — confirmed still present as of HEL-826; filing separately.
- spray-json silently dropping unknown fields on decode (convention-only guard, nothing structural prevents recurrence — this is what made `jsonPath` fiction originally) — filing separately.

## Session model override

concertino-skeptic: opus. concertino-orchestrator/executor/evaluator/auditor: sonnet.
