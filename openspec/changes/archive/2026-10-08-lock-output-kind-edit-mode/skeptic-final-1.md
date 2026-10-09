## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `b3243719484dc8ee4153c96c882172b2e8383b26` (code commit `ca48e7cc` plus a tasks.md tick). I resolved the base live with `resolve-review-base.sh`, which returned `6f2351e89d14e2e7ec0dd545476163f4d104a72d` (exit 0). The code diff is two files: `OutputEditorSheet.tsx` (+12/-2) and the new `OutputEditorSheet.kindLock.test.tsx`. The rest of the diff is openspec artifacts.

### What I verified (with evidence)
- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/lock-output-kind-edit-mode/HEL-1388`.
- **AC1: Kind is disabled in edit mode, with a short reason.**
  - `OutputEditorSheet.tsx:534-542` contains `disabled={!isCreate}` and `ariaDescribedBy={isCreate ? undefined : kindHintId}`. It also renders a `<p id={kindHintId} className="output-editor-sheet__field-hint">` with the reason, only when `!isCreate`. The hint reuses the existing hint class, so there is no new CSS or tokens.
  - In the running app (my own isolated Chromium, not the shared MCP browser), in both themes the Kind trigger was `BUTTON disabled=true`, showed the text "Chart", had opacity 0.55 and `cursor: not-allowed`.
- **No dead focusable control.**
  - Real-browser Tab from the Name field went `Chart type -> Group by field -> Aggregation value field`, skipping Kind. This held in dark and light.
  - A forced click opened 0 listboxes, and `aria-expanded` stayed `false`.
- **Reason exposed to assistive tech.**
  - `aria-describedby="_r_8_"` resolves to exactly one element (idCount 1), and its text is the reason.
  - The ARIA snapshot shows `combobox "Output kind" [disabled]: Chart` followed by `paragraph: An Output's kind can't be changed after it's created. ...`.
  - The jsdom test asserts `toHaveAccessibleDescription(REASON)`.
- **Create mode is unchanged.** In the running app, both themes: `disabled:false`, `aria-describedby:null`, opacity 1, and 0 reason text nodes. The create sheet also still shows the Step select.
- **AC2: the test covers both modes.** `OutputEditorSheet.kindLock.test.tsx` has 2 edit-mode tests and 1 create-mode test. I ran mutations myself in a throwaway detached worktree under the scratchpad, which I have since removed. The review worktree was never touched (`git status` was clean before and after).
  - green: 3 passed
  - M1 `disabled={false}`: 2 failed / 1 passed. Both edit tests go red.
  - M2 `ariaDescribedBy={undefined}`: 1 failed / 2 passed.
  - M3 hint `<p>` not rendered (line 537 only): 1 failed / 2 passed.
  - M4 `disabled={true}` always: 1 failed / 2 passed. The create-mode test catches a create-mode regression.
  - The tests can fail in both directions.
- **Gates, fresh, in the worktree.**
  - `npx jest src/features/pipelines/ui/outputEditor`: 12 suites / 197 tests passed, exit 0.
  - `npm run lint`: clean (eslint `--max-warnings=0`).
  - `npm run typecheck`: clean.
  - `prettier --check` on both changed files: clean.
  - For the full suite and build I relied on the evaluator's pasted results (exit 0, 481 suites / 5065 tests). The change is local to this component and its own test file.
- **The dev server serves this tree.** `curl http://localhost:6820/src/.../OutputEditorSheet.tsx | grep -c kindHintId` returned 3. `start-servers.sh` reused healthy servers, and `assert-phase.sh servers` returned PASS.
- **Debugging law.** The root cause is mechanical and already confirmed at Setup: `UpdateOutputRequest` has no `kind`, and the edit-mode Kind select had no `disabled`. The regression test fails without the fix (M1).

### Design judgment (both themes, against the running app)
Screenshots (durable refs):
- `/home/matt/Development/helio/.concertino/runs/HEL-1388/evidence/.concertino/runs/HEL-1388/evidence/skeptic1-edit-dark.png`
- `.../skeptic1-edit-light.png`
- `.../skeptic1-create-dark.png`
- `.../skeptic1-create-light.png`
- `.../skeptic1-edit-dark-375.png`

- **Dark-theme faintness (my design-gate concern): resolved.** The disabled trigger reads clearly as unavailable next to the full-strength Name field and Chart type select, and "Chart" is still legible. A rough estimate from the measured colours: text rgb(242,239,233) on rgb(22,21,20) at 0.55 opacity composites to roughly 5:1. Disabled controls are also exempt from WCAG 1.4.3. The muted 12px hint (rgb(170,164,156)) sits under the control with the same type, colour and spacing as the sheet's existing Stacking/Compare hints. The control and hint do not run together visually.
- **Light theme:** the structure matches dark. The hint is rgb(100,94,86) on the light surface, and the disabled fill is distinct from the enabled Name field.
- **Cohesion:** it uses the shared `Select` disabled styling (`inputs.css` `.ui-select__trigger:disabled`) and the sheet's existing hint class. That is the same disabled-control-plus-hint pairing as the History "Keep each run's rows" switch and `FormFieldRow`'s "Required by the dataset". There is no one-off styling.
- **375px:** the hint wraps to 2 lines inside the dialog. No overflow is introduced by this change.

### Verdict: CONFIRM

### Non-blocking notes
- The copy capitalises "Output" ("An Output's kind ... Create a new Output"), while the sheet title and rail use lowercase ("New output", "Add output"). The capitalised form has precedent in body copy (the history panel's "No runs recorded for this Output yet"), so this is not a defect, but a copy-casing sweep could normalise it.
- The 404 console error on `/pipelines/:id` is `GET .../schedule` for a pipeline with no schedule. It existed before this change.
- **Environment note for the orchestrator.** The shared Playwright MCP browser was logged in as another lane's user (the "HEL1392 dash" session, which is the parallel-Playwright hazard). I stopped using the MCP after one `navigate` and one read-only `evaluate`. That evaluate made two POSTs, both rejected with 403 by CSRF, so nothing changed for that lane. All my UI evidence comes from an isolated Chromium launched from a scratchpad node script. The single MCP navigate auto-wrote `page-2026-10-09T06-08-29-443Z.yml` and `console-2026-10-09T06-08-28-851Z.log` into `/home/matt/Development/helio/.playwright-mcp/`. That is MCP-side output I did not direct, and I have not deleted it (no writes under ~ outside the worktree/run dirs).
- **Residue.** The throwaway user `679e3d32-e747-447e-b742-f8b0aacdbc4f` (`skeptic-hel1388-1791526180240@example.test`) and its panels (3), dashboard, outputs (3), pipeline, data source, rate-window row and sessions were deleted by exact id. A recount across all 30 owner/user/created_by/grantee columns returned 0. The evaluator's user `23121ead-...` also counts 0.
- No claim in this report rests on mtime ordering.
