## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/agent-surface-credential-gate/spec.md`, `skeptic-design-1.md`, the shipped
`scripts/check-no-credential-in-agent-surface.mjs` and its `.selftest.mjs`.

**Round-1 change requests — re-derived from ground truth, not taken on trust:**

- **CR1 (drift guard red on main checkout) — resolved, with one false premise (see CR1 below).**
  Measured: worktree top level = `backend docs e2e frontend helio-mcp infra notes openspec schemas
  scripts`; main checkout additionally has `node_modules` and `test-results` — exactly as Decision 1b
  states. Decision 1b's skip design (dot-dirs + hardcoded `IGNORED_TOP_LEVEL`) plus task 2.6/5.5's
  "verify from BOTH checkouts" closes the mechanism. But its safety rationale is measurably false.
- **CR2 (vacuously-green drift case) — resolved.** Decision 5 and task 4.3 now mandate a
  non-dot-prefixed `hel956-selftest-drift-probe/`, correct design.md's blanket "every planted path is
  dot-prefixed" by naming the exception, and add idempotent startup cleanup + `.gitignore`. The
  contradiction is gone.
- **CR3 (prefix-gated literal shape) — resolved, and the bound is correct.** Verified every row of
  Decision 4a's table against the tree: `helio-mcp/src/config.ts:17` `const PAT_PREFIX =
  "helio_pat_";` (suffix 0), `queryParamsOrdering.test.ts:74` `pat: "helio_pat_test"` (4),
  `config.ts:28` / `README.md:38` `helio_pat_xxxxxxxx` (8), `README.md:45,53,56,68,230` `helio_pat_…`
  (0 — `…` outside `[A-Za-z0-9_-]`), `helio-mcp/e2e/sleeper-rebuild.ts:44` `helio_pat_...` (0 — `.`
  outside the class). All < 20, none fires. Real credential confirmed at
  `ApiTokenService.scala:133-140`: `TokenPrefix + 32 bytes hex` = 64 chars ≥ 20, so it does fire.
  `e2e/auth-cookie-migration.spec.ts:275` independently asserts `/^helio_pat_[0-9a-f]{64}$/`. The
  entropy floor is well-grounded.
- **CR4 (`frontend`/`backend` unclassifiable) — resolved.** Decision 1a's three-state model
  (`covered`/`partial`/`unscanned`) with `PARTIAL_COVERAGE` is a real distinct state, mirrored in
  tasks 2.3/2.5 and in the spec's "partially covered directory is not misreported as unscanned"
  scenario.

**Independent checks:**

- Baseline reproduced: `node scripts/check-no-credential-in-agent-surface.mjs` →
  `OK (16 files scanned: 13 assistant-surface, 3 fixture, 0 violations)`, exit 0 — byte-identical to
  task 1.1.
- MCP surface size re-measured under the stated include rule (`helio-mcp/`, minus `node_modules/`,
  `dist/`, and the binary extensions the fixture walk skips): **66 files**, matching design.md's
  estimate and its ~82 projection.
- Enumerated every `*KEY|SECRET|TOKEN|PASSWORD`-assigned string literal ≥ 8 chars on the MCP surface,
  double- and single-quoted and backticked — **7 hits, not 1** (see CR2 below).
- `git check-ignore -v` on all eight `IGNORED_TOP_LEVEL` names (see CR1 below).
- ACs 1–6 each still map to a task (3.1 / 1.3+2.7 / 2.1 / 4.1 / 3.3+3.4 / 5.4); no task exceeds the
  ticket's scope; the constraints (no Playwright/e2e, no migration, no real credential) are carried
  into tasks 5.2/5.3.

### Verdict: REFUTE

Three findings. All are small, specific corrections; the structure of the plan is sound and the four
round-1 CRs are genuinely addressed.

### Change Requests

1. **Decision 1b's justification for `IGNORED_TOP_LEVEL` is factually false, and the falsehood is
   scheduled to be copied into the script header (task 2.4).** design.md states: "All eight names are
   in `.gitignore` today, so this cannot silently hide tracked code without someone first committing a
   directory the repo already ignores." Measured with `git check-ignore -v` at the repo root:

   | name | root-level ignore status |
   | --- | --- |
   | `node_modules`, `dist`, `build`, `coverage`, `playwright-report`, `test-results` | ignored (`.gitignore:6,8,10,17,18,19`) |
   | **`target`** | **NOT ignored** — `.gitignore:11` is `backend/target/`, path-scoped |
   | **`out`** | **NOT ignored** — absent from `.gitignore` entirely |

   So a committed top-level `target/` or `out/` would be silently skipped by the drift guard with no
   `.gitignore` friction at all — the exact silent-miss class this ticket exists to eliminate — and the
   script header would assert otherwise. Pick one and state it in design.md and in task 2.4: drop
   `target` and `out` from `IGNORED_TOP_LEVEL` (they cost nothing to classify: neither exists at the
   top level today, and if one appears it goes on a list), or keep them and replace the claim with the
   accurate one (six of eight are root-ignored; `target`/`out` are skipped by name only and a committed
   one would be missed).

2. **Decision 4's measured claim about the identifier-name rule is wrong, and the one value it misses
   has no marker.** design.md Decision 4.2 states "(measured: `restDataSourceSchema.test.ts:69` is the
   *only* `*KEY|SECRET|TOKEN|PASSWORD` literal assignment on the MCP surface today)". Measured, there
   are seven:

   - `restDataSourceSchema.test.ts:41,54,69,83,97` and `connectorSchema.test.ts:146` — all
     `"sk-should-never-be-accepted"`, exempt via the `should-never` marker. Fine.
   - **`helio-mcp/e2e/connector-authoring.ts:109` — `password: "correct horse battery staple 1!"`**, a
     throwaway-registration password, ≥ 8 chars, carrying **none** of Decision 4.2's markers
     (`not-a-real`/`should-never`/`dummy`/`placeholder`/`fake`/`example`/`redacted`/all-zeros) and not
     all-zeros. Under the rule exactly as specified, the first run (task 3.5) is **red** on it.

   Unlike round-1 CR3 this does have a permitted resolution (reword the literal to carry a marker, e.g.
   `"not-a-real-password ..."` — it is a synthetic value used once, and the file is inside the scope
   proposal.md's Impact already anticipates editing), so it is not a dead end. But the design's
   pre-emptive measurement, its Risks section ("the residual unknown is the new secret-literal regex"),
   and task 3.5's expected outcome all read as if the first run will be clean. Correct the count in
   Decision 4, name `connector-authoring.ts:109` explicitly with its chosen resolution, and add it to
   task 3.2a's verification list so it is checked deliberately rather than discovered.

3. **The vacuity case's "documented self-test-only mechanism" is unspecified, and the obvious
   implementation contradicts a stated property of the gate.** Decision 5 / task 4.2 say the self-test
   "runs the gate with that directory declared as an extra surface via a documented self-test-only
   mechanism", without saying what it is. If it is an environment variable, the Gate-Chain checklist's
   own answer — "It reads no environment variable and depends on none" — becomes false in the same
   change that ships it. Name the mechanism in design.md (a CLI flag such as
   `--extra-surface=<relative-root>` preserves the no-env-var property; an env var requires updating
   that checklist answer), and state that the injected surface participates in the coverage
   classification so the drift guard does not fire on `hel956-selftest-drift-probe/` before the
   vacuity assertion is reached — the two cases share that directory name, and the ordering of the two
   failures is currently left implicit.

### Non-blocking notes

- Task 3.2a cites the placeholder locations as "`helio-mcp/README.md` and `e2e/sleeper-rebuild.ts`".
  The second file is `helio-mcp/e2e/sleeper-rebuild.ts`; the top-level `e2e/` is on
  `ACKNOWLEDGED_UNSCANNED` and is a different directory. Worth disambiguating so the implementer
  verifies against a file the gate actually scans. `config.ts:28` also carries a
  `helio_pat_xxxxxxxx` placeholder that design.md attributes only to `README.md`; it is equally safe
  (8 chars).
- The MCP surface's include rule sweeps `helio-mcp/package-lock.json` (large, machine-generated). It
  is clean today under all three checks — no `*KEY|SECRET|TOKEN|PASSWORD` assignment, no bcrypt, no
  non-reserved email — so nothing is needed now; noting it because a future lockfile regeneration is
  the most likely source of an unexplained red on this surface.
- `.gitignore:42` is a blanket `*.png` with `!docs/**` negations. The new `.gitignore` entries from
  task 4.3 should sit in the Concertino/local-artifacts region near the end rather than inside that
  negation block, to avoid interacting with it.
