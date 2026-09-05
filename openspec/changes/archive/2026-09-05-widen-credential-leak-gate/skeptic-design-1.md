## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/agent-surface-credential-gate/spec.md`, plus
  `scripts/check-no-credential-in-agent-surface.mjs` (334 lines) and its `.selftest.mjs` (129 lines).
- **Baseline reproduced.** `node scripts/check-no-credential-in-agent-surface.mjs` →
  `OK (16 files scanned: 13 assistant-surface, 3 fixture, 0 violations)`, exit 0. Matches task 1.1's
  claimed baseline byte-for-byte.
- **Design's measured claims about `helio-mcp/**` are accurate.** Reimplemented the fixture walk
  (excluding `node_modules`/`dist`/binary extensions) over `helio-mcp/`: **66 files**; running the
  shipped `EMAIL_REGEX` and `BCRYPT_HASH_REGEX` over them yields **0 email violations** (the only hit
  is `README.md`'s `example.com`, already allow-listed) and **0 bcrypt hits**. `grep -cE
  '\bcredential\b\s*\??\s*:' helio-mcp` → **8**, exactly as design.md states. Decision 3's rationale
  (those 8 are rejection declarations) is grounded.
- **Coverage gap in ACs:** ticket ACs 1–6 each map to a task (3.1, 1.3, 2.1, 4.1, 3.3/3.4, 5.4). No AC
  is uncovered; no task exceeds the ticket's scope.
- Probed the drift guard and secret-literal check against ground truth — three findings below.

### Verdict: REFUTE

### Change Requests

1. **The drift guard, as specified, is red on a normal developer checkout and on ephemeral output.**
   `design.md` and `tasks.md` 2.3 define the guard as "every top-level directory, ignoring
   dot-directories". Measured: this worktree's top level is
   `backend docs e2e frontend helio-mcp infra notes openspec schemas scripts`, but the **main checkout**
   (`/home/matt/Development/helio`) additionally has `node_modules/` and `test-results/`, both gitignored
   (`git check-ignore -v` → `.gitignore:6` and `.gitignore:19`). Task 2.4 says "populate for the repo as
   it stands" — populated from a worktree, the gate goes red on every developer's main checkout, and
   `test-results/` appears/disappears with any Playwright run, so the guard fires for reasons unrelated
   to coverage. That is precisely the "neutered within a week" outcome design.md Decision 1 argues
   against. Decide and state, in design.md, that the guard enumerates **tracked/non-ignored** top-level
   directories (and how it determines that without invoking git, since the Gate-Chain checklist asserts
   "no git invocation" — e.g. a hardcoded ignored-dir set, or relax that assertion deliberately), and
   have task 2.4 verify green against the main checkout, not only the worktree.

2. **Self-test case 4.3 is vacuously green as designed — internal contradiction.** design.md's
   Gate-Chain section states "Every planted path is dot-prefixed and selftest-named", and the same
   section states the drift guard "must ignore dot-directories (`.git`, `.claude`, `.husky`,
   `.concertino`) explicitly". A dot-prefixed planted top-level directory is therefore ignored by the
   guard and the case can never go red. Resolve explicitly: task 4.3's planted directory must be
   non-dot-prefixed (with the `finally`-guarded removal and the "must be removed on every exit path"
   note applying with more force, since a leftover non-dot dir makes the next run red), and design.md's
   blanket "every planted path is dot-prefixed" must be corrected to name the exception.

3. **The secret-literal check's shape is ambiguous, and the strict reading has no permitted
   resolution.** tasks.md 3.2 says "PAT/vendor-key-shaped literals (`helio_pat_`, `sk-ant-`)" without
   saying whether a bare prefix counts or a prefix-plus-entropy-suffix is required. Under the bare-prefix
   reading, measured live hits on the unmodified tree include `helio-mcp/src/config.ts:17`
   (`const PAT_PREFIX = "helio_pat_";` — a real production constant), `helio-mcp/src/tools/
   queryParamsOrdering.test.ts:74` (`pat: "helio_pat_test"`), and six `README.md` /
   `e2e/sleeper-rebuild.ts` doc placeholders (`helio_pat_…`, `helio_pat_xxxxxxxx`). **None carries a
   marker from Decision 4.2's set** (`not-a-real`/`should-never`/`dummy`/`placeholder`/`fake`/`example`/
   `redacted`/all-zeros), and task 3.5 forbids resolving a finding by widening an exclusion — leaving the
   implementer to rename a production constant to satisfy the gate. Specify the literal shape precisely
   (e.g. prefix followed by ≥N high-entropy characters, so a bare prefix constant and an ellipsis
   placeholder cannot match) and state in design.md how `PAT_PREFIX` and the README placeholders pass.
   Note `apiKey: "sk-should-never-be-accepted"` (restDataSourceSchema.test.ts:69) does pass via the
   `should-never` marker — that part of Decision 4.2 checks out.

4. **"Inside a surface root" is unresolvable for `frontend/` and `backend/`.** Both *contain* a surface
   root (`frontend/src/features/assistant`, `backend/src/test/resources`) but are not *inside* one. Under
   the literal rule in design.md Decision 1 and task 2.3 they must go on `ACKNOWLEDGED_UNSCANNED`, which
   records a falsehood (they are partially scanned) and would make a genuine future loss of the assistant
   surface indistinguishable from a deliberate acknowledgment. State the rule as "covered when a declared
   surface root is at, inside, **or beneath** it", and give the third state (partially covered) its own
   representation or an explicit reason string that says so.

### Non-blocking notes

- The drift guard is directory-only, so top-level *files* (`.env.example`, `Dockerfile`,
  `package-lock.json`, `README.md`) are silently uncovered while the proposal advertises "nothing is
  silently missed". design.md's top-level-only rationale is about subdirectory churn, not files; a
  one-line acknowledgment of the file gap in the script header would keep the stated scope honest —
  which is the exact class of stated-vs-actual mismatch this ticket exists to fix.
- Dot-directories (`.github`, `.husky`, `.claude`) are exempt from the guard by design and can hold
  credential-shaped content; worth naming in the "known residual limits" header block that task 1.3
  already touches.
- Task 4.2 forces a surface to zero files by "relocating/emptying its root". Moving real tracked source
  (`frontend/src/features/assistant`) in a shared checkout is the riskiest step in the plan; if the
  process dies between the move and the `finally`, the tree is broken. Consider driving the vacuity case
  through a surface whose root is a self-test-planted directory instead, or at minimum making the
  relocation an in-place rename with an idempotent restore at self-test startup.
