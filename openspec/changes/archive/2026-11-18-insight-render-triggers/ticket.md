# HEL-1743: Insight L4: render triggers (after run, daily, manual) with quota, caps and the delivery seam

## Description

Leaf of HEL-921 (narrative insight Outputs). Needs L2 (HEL-1742) and L3 (HEL-1741).

`InsightRenderService.renderForRun` runs after a real run succeeds, and only then. It never runs for dry runs or draft
previews, and it never fails the run.

## Owner rulings (ticket text)

- **D1 model:** use the shared `CLAUDE_MODEL`. Prod runs Haiku 5.5. (Amended by R1 below.)
- **D2 caps:** token caps per render, about 8k input and 400 output. Record dollars; do not enforce them.
- **D3 tiers:** beta and owner only. Each render counts 1 against the shared daily counter. A free-tier owner gets
  `skipped_quota` and no model call. (Amended by R2 below.)
- **D4 refresh:** the default is `on_run`. Skip when the input digest is unchanged, and render at most once per Output
  per hour.
- **D5 daily:** run `daily` as an interval-gated pass on the existing `PipelineSchedulerService` tick, the same way
  history retention runs. No new timer. State the UTC hour it fires.
- **D6 billing:** a render is charged to the pipeline owner, through the `AiPipelineQuotaGate` keyed on the owner.

## Owner rulings given 2026-11-18 (amend the ticket)

- **R1 (amends D1):** insights get a per-Output `model` config key (moved here from L1). Validate it against
  `ClaudeModelCatalog`, the single allow-list from HEL-1755 (ff667dd57); never keep a list of our own. Absent means the
  server default `CLAUDE_MODEL`. Honour the catalog's per-model request rules: no sampling params, no `budget_tokens`,
  no forced `tool_choice`.
- **R2 (amends D3):** a beta-tier render counts against the shared daily counter with the SAME weights as chat (Haiku 1,
  Sonnet 4, Opus 8), using the env-overridable `HELIO_BETA_MODEL_WEIGHTS` from HEL-1755. Owner tier is not counted; free
  tier gets `skipped_quota` with no model call.
- **R3 (fold-in from L2):** the authenticated insight routes (`GET /api/outputs/:id/insight` and `/history`) show model,
  token counts and `cost_micros` only to the pipeline OWNER and EDITOR grantees. A viewer grantee gets the reduced
  shape, like the public route. A fail-first test per role.

- **R3b (owner, 2026-11-18, relayed by the driver):** a viewer grantee DOES see status, trigger and citations, but
  `skipped_quota` and `skipped_budget` are shown to viewers as one neutral state (`not_updated`), so a viewer cannot
  tell the owner hit a limit. Owner and editors see the real status. Applies in the API shape of both
  `GET /api/outputs/:id/insight` and `/history`, with a fail-first test per role; named in the PR.

## Manual refresh

- `POST /api/outputs/:id/insight/refresh`, for owners and editors. A viewer gets 403.
- Its own rate-limit instance.

## Delivery seam

Publish an `InsightRendered` event and expose `latestFor(outputId)`, for HEL-919 delivery later.

## Acceptance criteria

- Fail-first: a render failure or timeout leaves the run `succeeded`, and its event timing does not change.
- A free-tier owner makes zero model sends, counted on a fake transport.
- Ten runs with identical data produce one model call.
- R1: an insight `model` outside the catalog's selectable set is rejected with 400 naming `model`; absent uses the
  server default; the request sent carries the chosen model and none of the forbidden request params.
- R2: a beta render is charged the catalog weight of the model it renders on (fakes show Haiku 1 / Sonnet 4 / Opus 8 and
  an env override); owner tier is never counted.
- R3: owner and editor see model, token counts and cost on both authenticated insight routes; a viewer does not
  (fail-first test per role).
- R3b: a viewer sees `not_updated` wherever the real status is `skipped_quota` or `skipped_budget`; owner and editor see
  the real status (fail-first test per role, both routes).
- Manual refresh: owner/editor allowed, viewer 403, stranger 404, own rate-limit instance.
- `InsightRendered` is published for an accepted render and `latestFor(outputId)` returns the newest ok render.
- `daily` fires on the existing scheduler tick at a stated UTC hour; no new timer.
- **Live check, pre-approved by the owner (D11):** one real render on `claude-haiku-5-5`, capped at $0.50. Assert the
  model id from telemetry before the call. Stop at the cap. Going over the cap means escalate. Sonnet/Opus live renders
  are NOT approved.

## Migration

None (unless a failure-reason column is judged necessary; decided in design.md).

## Agent notes

Hook point: after `publishTerminalAfter` in `PipelineRunSucceededWrites.scala` (line 331 on main at 374741b68, not 310),
run asynchronously. Do NOT hook inside the writes chain, where `succeeded` would wait on the model.
`PipelineSchedulerService.runPasses` holds the existing started-not-awaited interval passes to copy.
The code's default model is opus-4-8. Set `CLAUDE_MODEL=claude-haiku-5-5` for the live check.

## Owner answer 2026-11-18 and fold-ins from merged siblings

The owner answered `proceed-to-execution` after design round 6. Round 6's two required changes are execution
requirements the evaluator checks: ER1, catch-up under overlapping runs and under a success followed by a failed run;
ER2, a no-model `failed` row merges only into another no-model `failed` row.

Debts recorded in merged sibling changes (`archive/2026-11-18-insight-authoring-citation-chips`,
`archive/2026-11-18-ask-your-data-backend`, `archive/2026-11-18-ask-ui-pin-insight`) that this leaf owes:
- Render on pin: a pinned insight renders once after it is created (trigger `pin`).
- The per-Output model selector in the Output editor (slot after the preset in `InsightKindFields.tsx`).
- The manual refresh button on the insight panel (sets the existing `refreshPending` state).
- Editor quota wording: editors see the real quota state, which the role-shaped read now allows.
- The L5 e2e psql seed (`e2e/support/insightSeed.ts`): replaced by the real trigger where possible (see design D13).

Acceptance criteria added:
- A successful pin starts one render with trigger `pin`; a failed refresh call never fails the pin.
- Owner and editor see a refresh button on an authenticated insight panel; viewers and public viewers do not.
- The Output editor offers the selectable models plus "Server default"; saving writes or clears `model`.
- An editor sees quota wording for `skipped_quota`; a viewer sees the neutral note.

## Owner answers 2026-11-18 (cycle 2)

- **D2 amended (A-raise-cap-4096):** insight render `max_tokens` is 4096, the same value HEL-1761 set for ask, because
  Haiku 5.5's adaptive thinking shares the output budget. The narrative stays bounded by `maxSentences`/`maxChars` and
  the validator. A test pins the 4096 cap.
- **One more live render approved:** same terms as C15. Failed rows that made a call record their usage and cost.
