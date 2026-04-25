## Evaluation Report — Cycle 1

### Phase 1: Spec Review — FAIL

**Issues:**

1. **Incomplete AC 1 — missing orchestrator DEV_PORT assignment**
   
   AC 1 states: "Two orchestrators can run simultaneously on different tickets without either dev server failing to start"
   
   The implementation provides the evaluator-side mechanism (reads `DEV_PORT`, passes to dev server), but does NOT include orchestrator-side logic to assign unique `DEV_PORT` values. Currently:
   
   - The evaluator expects to read `DEV_PORT` (new) ✓
   - The Vite config reads `PORT` (new) ✓
   - But `linear-orchestrator.md` was NOT updated to set `DEV_PORT` before calling the evaluator ✗
   
   **Current orchestrator invocation:**
   ```
   Agent call with subagent_type: linear-evaluator.
   > WORKTREE_PATH=`<path>`, CHANGE_NAME=`<name>`, TICKET_ID=`<id>`, CYCLE=1.
   ```
   
   **Consequence:** If two orchestrators run in parallel without explicit `DEV_PORT` assignment from an external caller, both evaluators default to port 5173, and one fails with EADDRINUSE (the exact problem this ticket aims to solve).
   
   **Design states:** "The orchestrator or caller sets `DEV_PORT=<port>` before invoking the evaluator" — but this logic is missing from the code. Responsibility is not clear.

2. **AC 1 and AC 3 depend on external orchestrator behavior**
   
   - AC 1: "Two orchestrators can run simultaneously..." — only achievable if DEV_PORT is externally set per session
   - AC 3: "Playwright tests correctly target the port..." — only achievable if DEV_PORT is set
   
   These ACs should either be reworded to assume external port assignment, or the orchestrator.md must be updated to provide automatic assignment (e.g., deriving from TICKET_ID as described in the ticket description: "e.g. 5173 + ticket number offset").

3. **All tasks marked complete but scope is incomplete**
   
   tasks.md lists:
   - [x] 1.1 Create backend/.sbtopts ✓
   - [x] 2.1 Update frontend/vite.config.ts ✓  
   - [x] 3.1 Update .claude/agents/linear-evaluator.md ✓
   
   Missing:
   - [ ] Update `.claude/agents/linear-orchestrator.md` to assign DEV_PORT before invoking evaluator

4. **AC 4 (single orchestrator unaffected) — appears satisfied**
   
   When `DEV_PORT` is not set, both vite and evaluator default to 5173 (original behavior). ✓

### Phase 2: Code Review — PASS

**Changes:**

1. **frontend/vite.config.ts** (3 lines)
   - Reads `process.env.PORT` and parses with `parseInt(process.env.PORT ?? "5173")`
   - Sets `strictPort: true` for loud failure on port collision
   - Correctly idiomatic Vite config; no issues

2. **backend/.sbtopts** (1 line)
   - Sets `-Dsbt.ivy.home=.ivy2` to scope Ivy cache per-worktree
   - sbt auto-loads .sbtopts; verified with `sbt -v` output showing the setting is applied
   - Prevents shared global `~/.ivy2` lock contention; correct approach

3. **.claude/agents/linear-evaluator.md** (12 lines changed)
   - Updated Phase 3 dev-server startup: `PORT=${DEV_PORT:-5173} npm run dev &`
   - Updated Playwright base URL: `http://localhost:${DEV_PORT:-5173}`
   - Uses bash parameter expansion correctly; no issues
   - Properly defaults to 5173 for single-orchestrator case

**Code quality:**
- DRY ✓ (no duplication)
- Readable ✓ (clear defaults, no magic values)
- Modular ✓ (isolated changes)
- No security issues ✓
- No error handling needed (config, not logic) ✓
- No dead code ✓
- Not over-engineered ✓

### Phase 3: UI / Playwright Review — PASS

**Trigger check:**
- `frontend/vite.config.ts` modified → Phase 3 triggered ✓

**Test results:**

1. **Dev server on default port 5173 (no PORT set)**
   - ✓ Server starts and responds to HTTP requests
   - ✓ Behavior unchanged from pre-implementation

2. **Dev server on custom port (PORT=5200)**
   - ✓ Server starts on specified port
   - ✓ Responds correctly

3. **Port conflict detection (strictPort: true)**
   - ✓ Second server on same port fails immediately
   - ✓ Error message: "Port 5173 is already in use"
   - ✓ Clear failure (no silent rebind to different port)

4. **No console errors**
   - ✓ Dev server startup logs show no warnings or errors

5. **Backward compatibility**
   - ✓ Single-orchestrator startup time unaffected
   - ✓ Default port behavior identical to before

**Assessed risks:**
- `strictPort: true` will cause immediate failure if caller doesn't assign unique ports, which is actually desirable (loud failure is better than silent port mismatch)
- No visual or functionality changes to the UI

### Overall: FAIL

The implementation is **well-executed but incomplete**. The evaluator-side infrastructure is correct (reads PORT/DEV_PORT, uses strictPort, Playwright targets correct port), and Phase 2 code is clean. However, **the orchestrator was not updated to assign unique DEV_PORT values**, which means AC 1 ("Two orchestrators can run simultaneously...") is not satisfied in a self-contained way.

The ticket describes desired behavior: "detect if the default port is in use and either pick a free port dynamically or derive a stable port from the ticket ID (e.g. 5173 + ticket number offset)." The current implementation does neither — it fails loud instead. A more complete fix would have the orchestrator derive `DEV_PORT = 5173 + ticket_number` before invoking the evaluator.

### Change Requests

1. **Update `.claude/agents/linear-orchestrator.md` to assign DEV_PORT before invoking evaluator**
   
   In the "Cycles 1 — fresh spawns" section, update the evaluator call to:
   ```
   # Derive port from ticket ID (e.g., HEL-55 → 5173 + 55 = 5228)
   TICKET_NUM=$(echo "$TICKET_ID" | sed 's/^HEL-//')
   DEV_PORT=$((5173 + TICKET_NUM))
   
   Agent call with subagent_type: linear-evaluator. Prompt:
   > WORKTREE_PATH=`<path>`, CHANGE_NAME=`<name>`, TICKET_ID=`<id>`, CYCLE=1, DEV_PORT=${DEV_PORT}.
   > Evaluate this implementation.
   ```
   
   Similarly, update the "Cycles 2 and 3" SendMessage calls to pass `DEV_PORT=${DEV_PORT}`.
   
   This ensures each orchestrator session gets a unique, stable port without external orchestration.

2. **Update ticket.md AC wording (optional clarity improvement)**
   
   AC 1 could be more explicit:
   ```
   - [ ] Two orchestrators can run simultaneously on different tickets without either dev server failing to start
     (orchestrator assigns unique DEV_PORT values, or external caller does)
   ```
   
   This removes ambiguity about who is responsible for port assignment.

### Non-blocking Suggestions

- Consider adding a comment in `vite.config.ts` explaining why `strictPort: true` is set (prevents silent port mismatch bugs in multi-instance scenarios)
- The design doc's "Planner Notes" section mentions `strictPort: true` ensures "failure is loud when a port collision does occur" — this is valuable context that could be a code comment

---

**Summary:** The implementation provides evaluator-side port configuration correctly but is missing orchestrator-side DEV_PORT assignment logic. With the Change Request implemented, AC 1–4 will all be satisfied and parallel orchestrators can run without collision.
