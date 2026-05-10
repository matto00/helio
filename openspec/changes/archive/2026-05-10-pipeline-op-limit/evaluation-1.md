## Evaluation Report — Cycle 1

### Phase 1: Spec Review — FAIL

Issues:
- **Missing: `PipelineStepRoutes.allowedOps` not updated.** `backend/src/main/scala/com/helio/api/routes/PipelineStepRoutes.scala` line 15 has a hardcoded allowlist `Set("rename", "filter", "join", "compute", "groupby", "cast", "select")` that does not include `"limit"`. Every `POST /api/pipelines/{id}/steps` request with `op = "limit"` returns 400 Bad Request. Step creation is gated by this check (line 52), and PATCH op-update is also gated (line 83). The engine change and the frontend wiring are correct, but the API entry-point silently rejects all limit steps — making the AC "A 'Limit rows' step can be added to a pipeline" **not met end-to-end**.
- **Missing: No DB migration for the `op` CHECK constraint.** Migrations `V23__pipeline_steps.sql` and `V25__add_select_op.sql` establish a `CHECK (op IN (...))` constraint on the `pipeline_steps.op` column. `"limit"` is absent from that constraint. Even if `PipelineStepRoutes` were fixed, an insert of `op = 'limit'` would fail at the PostgreSQL layer with a check-constraint violation. A new migration (`V26__add_limit_op.sql`) is required.
- **Tasks.md completeness:** All 12 tasks are marked `[x]`, but tasks 1.1 and 1.2 ("add applyLimit", "add 'limit' case to applyStep") are listed as the only backend tasks. The two missing pieces (`PipelineStepRoutes` allowlist and DB migration) are not captured anywhere in tasks.md. The spec artifacts do not reflect the full work required.
- All other ACs are addressed: analyze pass-through was pre-covered (confirmed in `PipelineAnalyzeServiceSpec` line 110), config shape `{"count":<int>}` is correct, invalid/missing count is a no-op in the engine, UI rejects N ≤ 0 with inline validation, backend engine tests cover the three required cases, task 3.2 is legitimately pre-covered (no action needed).

---

### Phase 2: Code Review — PASS

Issues:
- **`PipelineStepRoutes.allowedOps`** — The missing `"limit"` entry is the root cause of the E2E failure (see Phase 1). As a code review item: `PipelineStepRoutes.scala` line 15 must have `"limit"` added to the set.
- Everything else is well-implemented:
  - `applyLimit` is a clean, pure method. `getOrElse(0)` → `count <= 0` guard correctly produces the no-op (return all rows) for missing/zero/negative count. Consistent with design decision D2.
  - `LimitConfig.tsx` is thin and correct. `onChange` only fires on valid (> 0) parsed values. Inline validation error renders via `role="alert"` on `count <= 0` prop. Both the label association (`htmlFor`/`id`) and the explicit `aria-label` are present; they're redundant but harmless — accessible name resolves correctly.
  - `parseLimitConfig` is defensive (try/catch, guards `opTypeId !== "limit"`), defaults to 100.
  - `StepCard` wiring follows the exact same pattern as `handleAggregateChange` / `handleFilterChange`. `handleLimitChange` error catch is intentional (consistent with other handlers) and documented with a comment.
  - No unused imports, no dead code, no `any`, no magic values (100 default is the intentional UX default matching `handleAddStep`).
  - Frontend tests are meaningful: six cases cover rendering, valid change, zero rejection, negative rejection, error display on `count=0` prop, and no-error on `count>0` prop.
  - Backend tests cover the three required cases from the ticket (truncate to N, count > total rows, count = 0 no-op).

---

### Phase 3: UI Review — FAIL

Servers started successfully (backend on :8273, frontend on :5366). Login succeeded.

Checks:
- [x] "⬆ Limit rows" appears in the op-type dropdown after clicking "+ Add transformation step" — correct.
- [x] `LimitConfig` component renders when the step card is expanded: `type="number"`, `min="1"`, `value="100"`, `aria-label="Row limit"` — all correct.
- [x] Typing a new value (e.g. 5) updates the input value; the React `onChange` handler fires correctly in the frontend.
- [ ] **FAIL — Step creation blocked by backend.** `POST /api/pipelines/{id}/steps` with `op:"limit"` returns **400 Bad Request**: `"Invalid op 'limit'. Allowed values: join, compute, select, cast, groupby, rename, filter"`. Confirmed via Playwright console and direct `curl`. The limit step is not persisted; the UI shows the step card optimistically but the step does not survive a page refresh.
- [ ] **FAIL — Even if route were fixed, DB would reject it.** `V25__add_select_op.sql` constrains `op` to a fixed enum without `"limit"`. A direct insert would raise a PostgreSQL check-constraint violation.
- [ ] Pipeline run returned **422** with `"key not found: fields"` — this is a pre-existing demo-data issue (a select step with an empty config string), unrelated to this change. Not a regression.
- [x] No console errors attributable to this change (the two errors observed are: 400 on step creation, and 404 on `step-1` from pre-existing demo data).
- [x] Visual style is consistent with other step cards; the limit config input matches existing form patterns.
- [x] Keyboard support: label is associated to input via `htmlFor`/`id`; `aria-label` provides accessible name; `role="alert"` on error message.

---

### Overall: FAIL

### Change Requests

1. **Add `"limit"` to `allowedOps` in `PipelineStepRoutes.scala`.**
   File: `backend/src/main/scala/com/helio/api/routes/PipelineStepRoutes.scala`, line 15.
   Change:
   ```scala
   private val allowedOps: Set[String] = Set("rename", "filter", "join", "compute", "groupby", "cast", "select")
   ```
   To:
   ```scala
   private val allowedOps: Set[String] = Set("rename", "filter", "join", "compute", "groupby", "cast", "select", "limit")
   ```

2. **Add a Flyway migration to extend the `op` CHECK constraint.**
   Create `backend/src/main/resources/db/migration/V26__add_limit_op.sql` with content:
   ```sql
   ALTER TABLE pipeline_steps
     DROP CONSTRAINT IF EXISTS pipeline_steps_op_check;

   ALTER TABLE pipeline_steps
     ADD CONSTRAINT pipeline_steps_op_check
       CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit'));
   ```
   (Exact constraint name may differ — verify with `\d pipeline_steps` in psql and use the actual name.)

### Non-blocking Suggestions

- `LimitConfig.tsx`: The `<label htmlFor="limit-count-input">` and `aria-label="Row limit"` on the input are redundant. Consider removing the explicit `aria-label` so the accessible name is derived from the label element (which also displays the "(N)" suffix to sighted users). The test can still use `getByRole("spinbutton", { name: /row limit/i })` — it will match the label text instead. Minor; does not affect functionality.
