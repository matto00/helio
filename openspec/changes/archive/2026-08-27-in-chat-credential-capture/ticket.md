# HEL-829: In-chat credential capture: dynamic form for a proposed Connector's API key that bypasses the agent entirely

## Description

Child 8 (last) of HEL-820 (epic: Connectors — reusable credentialed hosts, parameterized source authoring). Depends on children 1 (HEL-821), 2 (HEL-536), and 7 (HEL-824) — all merged on main.

### The problem this solves

When the assistant proposes a pipeline, dashboard, or combined proposal that needs a **new** Connector, there is a setup cliff: the user has to leave the conversation, go to the Connectors page, create the Connector, come back, and re-run the proposal. Alternatively the agent asks for the key in chat — which is worse, because the secret then travels through the model context.

Neither is acceptable. The first is friction; the second is a security failure.

### The design

When a proposal requires a Connector the workspace does not yet have, the chat surface renders a **dynamic credential form inline** — part of the proposal-review flow, not a detour out of it.

**The form posts the credential directly to the backend. It never passes through the agent, the conversation transcript, or the model context.**

Requirements:

* **Rendered inline** in the chat/proposal-review surface, at the point the proposal needs it. The proposal stays reviewable and applies once the Connector exists.
* **Provider-specific retrieval instructions** — where to get the key for this API, so a user who has never used the provider is not left guessing. The agent researching the API is well positioned to supply the *instructions*; it must never receive the *key*.
* **An explicit statement to the user, in the form:** agents never see API keys, and this is enforced in code — not a policy, a mechanism.
* **Submitted value goes straight to the Connector-creation endpoint.** It is not echoed into the transcript, not included in any tool result, not persisted in conversation state.
* **The key is never displayed on screen again** after entry — no reveal, anywhere. This form is the only place a raw credential is ever visible, and only while being typed.

### Storage

Encrypted at rest, decrypted only at the moment of invoking the outbound request. That is the correct procedure and it is what HEL-821 builds.

One clarification worth stating precisely: the credential must be **encrypted**, not merely *encoded*. Encoding (base64 and similar) is reversible by anyone who reads the value and provides no protection. HEL-821's acceptance criteria require verifying the stored bytes are not recoverable plaintext by querying the database directly.

### The "enforced in code" claim needs a mechanism

The form will tell users that agents never see their keys. **That claim must be true by construction and verifiable**, not merely asserted in UI copy. Determine and build the enforcement: the credential field must be structurally incapable of entering the conversation transcript, the assistant's context assembly, or any MCP tool result. Coordinate with HEL-828 (agent/MCP surface — no tool creates/updates Connector credentials) and HEL-616 (mechanical guard against logging connector secrets).

## Acceptance Criteria

- [ ] A proposal requiring a new Connector renders the credential form inline; the user completes setup without leaving the proposal flow
- [ ] Provider-specific retrieval instructions are shown
- [ ] **Demonstrated:** the submitted credential does not appear in the conversation transcript, the assistant's context, any tool result, or logs. Enumerate every surface that could carry it and verify each — in both directions
- [ ] The enforcement is **mechanical**, and its failure mode is tested: a deliberate attempt to route the credential into agent-visible state fails a check. **Demonstrated red.**
- [ ] The raw credential is never displayed after submission
- [ ] The UI's claim about agents never seeing keys is accurate — verified against the mechanism, not assumed
- [ ] Works for the proposal kinds that can require a new Connector: pipeline, dashboard, and combined

## Design constraints

`DESIGN.md` binding; shared primitives. Add to HEL-813's touch-target sweep at 430px/768px.

This form handles a secret — treat its UX seriously. A user pasting an API key needs to be confident about where it is going, and the form is the only thing telling them.

## Origin

Product-owner design note, 2026-08-25: "the chat ui should have a dynamic ui which surfaces a form to enter the api key… it will NOT go back to the agent… This way there's minimal setup friction and it's very secure."

## Premise-validation notes (orchestrator, pre-Planning)

- `ConnectorCredentialField` (`frontend/src/features/connectors/ui/ConnectorCredentialField.tsx`) already exists, built by HEL-824 specifically to be reused here (standalone, page-agnostic auth-type selector + credential input). **Reuse it directly — do not build a second credential input.**
- No existing connector-requirement detection exists anywhere (no proposal type/schema field, no UI). This scope is net-new: (1) detecting when a generated proposal (pipeline/dashboard/combined) references a Connector the workspace doesn't have, (2) rendering the credential form inline on the existing proposal-review pages (`/proposals/review`, `/pipeline-proposals/review`, `/combined-proposals/review`), reached from chat via `ProposalHandoff.tsx`'s existing `navigate(..., {state:{proposal}})` pattern.
- The "mechanical, demonstrated-red enforcement" AC is the hard part: it must be a structural (type-level/API-surface-level) guarantee, not a lint rule alone, that the credential value can never reach model context — with an automated test that attempts the violation and asserts it fails.
