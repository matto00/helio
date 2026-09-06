# HEL-845: REST source Connector picker accepts a mismatched-kind Connector silently

## Description

`frontend/src/features/sources/ui/forms/ConnectorSelectField.tsx` — the Connector picker HEL-827 added to the REST source form — lists Connectors of every kind, unfiltered, and selecting a mismatched kind is accepted with no feedback at all. Confirmed by live Playwright verification during HEL-828: selecting a `sql`-kind Connector in the REST source form produces no warning and no validation error. The form neutrally displays "Requests use <name> (sql)" and lets the user proceed.

The picker calls `GET /api/connectors` unfiltered. Nothing downstream rejects the mismatch at authoring time either.

The user's mistake is silently accepted at the exact moment it is made, and the consequence surfaces much later as a failing fetch whose cause is not obvious from the error. This is the same class as HEL-826's UI-only `jsonPath` fiction and HEL-814/HEL-671's silently-tolerant decoders. It is newly reachable: before HEL-827 there was no picker, and before HEL-821 there were no Connector instances to mismatch. The epic created the affordance and did not constrain it.

`ConnectorSummary` already carries `kind` (HEL-828), so the data needed for client-side filtering is already present.

## Premise validation (orchestrator, pre-Planning)

Verdict: **no-drift**. Every cited fact was re-confirmed against `main` at `e01aa6d4`. See `.concertino/runs/HEL-845/evidence/premise-validation.md` in the main checkout. Key confirmations:

- `ConnectorSelectField.tsx:37` builds its options with no kind predicate.
- `DataSourceProtocol.scala:379-404` validates `connectorId` structurally only (exactly-one-of connectorId/url, non-empty, not a reserved sentinel) and never loads the Connector, so it structurally cannot see `kind`.
- `RestApiConnectorDriver.resolveConnector` (lines 72-85) returns `Right(c)` without inspecting `c.kind`; `RestApiConnectorDriver:143` then joins the non-REST Connector's `baseUrl` into a request URI.
- `CreateConnectorRequest.kind` is a free `String` and `ConnectorEntityRoutes` contains no occurrence of `kind` — arbitrary kinds are persisted unvalidated. Both UI creation paths hardcode `rest_api`, so mismatched rows arise via the API/agent surface, exactly as the ticket describes.

## Scope direction from the coordinator

- The shape of the fix matters more than the fix. UI-only filtering is an **affordance**, not a guarantee — the agent/MCP surface and any direct API caller bypass it. Server-side validation is the real guarantee.
- HEL-827 was about the UI authoring *less* than an agent can. Do not ship the inverse: a UI that prevents something the API still allows. If both layers are implemented, `design.md` must state which is the guarantee and which is the affordance.
- If the server-side check requires a contract change, update `schemas/` and `openspec/` in the same change (CLAUDE.md API-contract rule).
- Do not touch files owned by concurrent runs: HEL-890 (secondary-source truncation reporting) and HEL-973 (`PipelineStepRepository`, pipelines schema directory).
- Credentials: never log, echo, or commit a real secret; never write one into a fixture or a ticket comment.

## Evidence standard

- Confirm the red arm can actually fire before demanding a mutation. A mutation that cannot go red is an instruction to weaken the assertion until it passes.
- Confirm a failure isolates to the intended step.
- Two mutations producing the same observation are one axis wearing two labels, not two checks.
- A test that re-derives its expected value from the same source as the implementation asserts nothing.
- **A status-code assertion is not a content assertion.** HEL-590 shipped a non-functional feature through two review cycles with ~6,600 tests green because every test asserted status codes and none asserted returned data. If a test here asserts a request succeeded, assert on what came back too.
- Any assertion involving focus or visibility in jsdom is vacuous by construction — jsdom has no layout. Use a real browser for those.

## Acceptance criteria

- [ ] The REST source form's picker lists only `rest_api` Connectors — demonstrated live, not asserted from the filter expression
- [ ] A mismatched `connectorId` submitted directly to the API is either rejected with a clear error naming the kind mismatch, or the decision not to reject it is recorded with reasoning
- [ ] The no-matching-Connector case shows an explanatory empty state rather than a bare empty control
- [ ] A red test demonstrates the current silent acceptance before the fix, so the guard is not vacuous
- [ ] Any existing source bound to a mismatched Connector behaves predictably — decided and documented, not left to chance
