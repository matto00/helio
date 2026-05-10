## Evaluation Report — Cycle 2

### Phase 1: Spec Review — PASS

Issues:
- Both cycle 1 change requests are fully resolved:
  - `"limit"` added to `allowedOps` in `PipelineStepRoutes.scala` — direct API test confirms `POST /api/pipelines/{id}/steps` with `op:"limit"` now returns **201 Created**.
  - `V26__add_limit_op.sql` migration created — extends the `pipeline_steps_op_check` constraint to include `'limit'`, unblocking the PostgreSQL INSERT.
- All Linear ticket ACs are addressed end-to-end.
- All 12 `tasks.md` items marked `[x]` match the implementation.
- No scope creep; no regressions.
- API contract update (`allowedOps` + DB constraint) is in the same change as the engine and frontend wiring — consistent with schema-update policy.

---

### Phase 2: Code Review — PASS

Issues: none

The two additions introduced in this cycle are clean and correct:

- `PipelineStepRoutes.scala` line 15: `"limit"` added to `allowedOps` set — minimal, precise, no side effects.
- `V26__add_limit_op.sql`: Uses `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` pattern (correct for PostgreSQL CHECK constraints, which do not support `ALTER CONSTRAINT`). Constraint name matches the existing pattern from `V25__add_select_op.sql`. Full op enum is correctly enumerated.

All cycle 1 Phase 2 observations remain PASS — no regressions introduced.

---

### Phase 3: UI Review — PASS

Backend restarted from worktree (port 8273) to pick up the compiled `PipelineStepRoutes` change. Frontend already running on port 5366.

Checks:
- [x] **"⬆ Limit rows" appears in the add-step dropdown** — confirmed.
- [x] **Step creation persists** — `POST /api/pipelines/{id}/steps` with `op:"limit"` returns 201; step card survives page reload.
- [x] **LimitConfig renders correctly** — `type="number"`, `min="1"`, `value="7"` (persisted from previous session), `aria-label="Row limit"`, `<label for="limit-count-input">Row limit (N)</label>` — all correct.
- [x] **Config changes persist** — changed count to 7 via Playwright `fill`, reloaded page; value loads back as 7.
- [x] **Invalid-value rejection works** — typing `0` into the controlled input does not call `onChange`; React reverts the input to the current valid count (7). No invalid config is saved.
- [x] **No console errors** — 0 errors, 0 warnings throughout all flows.
- [x] **Visual consistency** — step card layout, label, and input match existing op config patterns.
- [x] **ARIA / keyboard support** — `<label htmlFor>` associates label to input; `aria-label="Row limit"` provides accessible name; `role="alert"` on validation error (exercised in Jest tests); `min="1"` enforces browser-level constraint.
- [x] **Pre-existing "0 rows" after pipeline run** — same 422 error documented in cycle 1 (broken `select` step in demo data); not a regression from this change.

---

### Overall: PASS

### Non-blocking Suggestions

- `LimitConfig.tsx`: Both `<label htmlFor="limit-count-input">` and `aria-label="Row limit"` supply an accessible name for the same input. They are redundant; removing `aria-label` would make the accessible name derived from the label (which also exposes the "(N)" suffix to sighted users). The Jest test `getByRole("spinbutton", { name: /row limit/i })` still passes because it matches the label text. Minor; no functional impact.
