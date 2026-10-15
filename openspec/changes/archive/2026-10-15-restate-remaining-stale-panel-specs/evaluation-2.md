## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD 7c3ca5fd38672e4750ddbf649f1abac3e816e826 against the live-resolved base 1ebf23fd0dab625242d9e03e4c46f494939409ef. This cycle's delta is `7a8bf4c19..7c3ca5fd3`.

### Phase 1: Spec Review — PASS

All three cycle-1 change requests are resolved.

1. **CR1 (panel-polling).** The requirement now reads "every `refreshInterval` seconds, starting from mount, while the browser tab is visible (the hook does not wait for the initial data load)", and its scenario matches. This is true against `usePanelPolling.ts:24-55`: the interval starts when the effect runs and the tab is visible, and the visibility handler stops and restarts it. The claim is recorded in evidence.md ("Cycle 2 CR1").
2. **CR2 (collection-config-editor).** The Format select now lists the values `number…durationMs` with labels Number, Integer, Currency ($), Percent (%), Duration, Duration (ms). This matches `METRIC_FORMAT_OPTIONS` (`OutputKindFields.tsx:253-260`) and is recorded in evidence.md.
3. **CR3 (mcp Reason).** The executor's dispute is correct, and my cycle-1 finding was half wrong. I parsed `schemas/dashboards/dashboard-proposal.schema.json` (`$defs.ProposalPanel.properties`). Every one of fieldMapping, aggregation, label, unit, chartType, xAxisLabel, yAxisLabel, seriesColors and sort contains "Legacy field, decoded but never applied". Only fieldMapping, aggregation, label and unit also start with "Deprecated and ignored…". In cycle 1 I truncated the descriptions at 150 characters, which hid the "Previously: Legacy field, decoded but never applied" tail on the four deprecated fields. The new wording states both facts accurately.

Constraints:
- **C1:** the new claims each have an evidence block.
- **C2:** `git diff --name-only BASE...HEAD` shows only `openspec/` paths.
- **C3:** no echarts path is in the diff.

The cycle-1 non-blocking note is also fixed: files-modified.md now says `workflow-state.md` is excluded and not committed.

Issues: none.

### Phase 2: Code Review — PASS

No `frontend/**` or `backend/**` file changed, so the code gates do not apply. I re-ran these myself:
- `openspec validate restate-remaining-stale-panel-specs --type change --strict` passed ("valid").
- `npm run check:openspec` passed ("openspec/ is clean").
- I did a simulated archive in a throwaway copy (`git archive HEAD openspec`, then `openspec archive --yes`). It printed "Totals: + 12, ~ 7, - 14", and `openspec validate --specs --strict` then passed 494/494. The archived panel-polling spec carries the new CR1 wording. I removed the copy.

Issues: none.

### Phase 3: UI Review — N/A

The change is docs/specs only, with no runtime, schema, route or frontend file in the diff.

### Overall: PASS

### Non-blocking Suggestions
- None new. evidence.md section D ("Out of scope, observed") remains the Delivery-triage list, including the echarts `typeId` deferral and the CLAUDE.md contradiction over `GET /api/dashboards/:id/panels`.
