## 1. Restructure the gate around a declared surface table

- [x] 1.1 Record the baseline: run `npm run check:no-credential-leak` on the unmodified tree and capture the exact
      OK line (`16 files scanned: 13 assistant-surface, 3 fixture, 0 violations`) for the PR's before/after evidence.
- [x] 1.2 Introduce a `SURFACES` table in `scripts/check-no-credential-in-agent-surface.mjs`: each entry declares
      `id`, `root` (repo-relative), an include/exclude rule, and the list of checks that apply. Port the two
      existing roots onto it — `assistant` (import-graph + credential-prop, `.ts`/`.tsx`, non-test) and `fixture`
      (bcrypt + email, all non-binary files) — with no change to what either currently scans or reports.
- [x] 1.3 Rewrite the script header so it describes the surface table as the coverage source of truth, replacing the
      prose list of roots. Keep the existing "known residual limits" notes, updated where this change resolves one.
      Explicitly reconcile the header's existing HEL-846 boundary sentence ("generic token-shaped secret strings ...
      are HEL-846's guard, not this one") with the new `mcp` secret-literal check, so the script does not ship two
      contradictory scope statements.
- [x] 1.4 Re-run the gate; confirm the OK line is byte-identical to 1.1's baseline. This is the behavior-preserving
      checkpoint before any widening.

## 2. Fail loudly on a vacuous or drifted run

- [x] 2.1 Compute per-surface file counts and fail non-zero when any declared surface matches zero files, naming the
      surface id and its root and stating that it matched nothing.
- [x] 2.2 Print the per-surface breakdown on the success line so the total stays checkable against the table.
- [x] 2.3 Add the coverage guard with the three states from design.md Decision 1a: `covered` (a declared surface
      root is at, inside, or beneath the directory and covers all of it), `partial` (a surface root is beneath it;
      requires a `PARTIAL_COVERAGE` entry naming the scanned subtree and why the rest is not scanned), and
      `unscanned` (requires an `ACKNOWLEDGED_UNSCANNED` entry with a one-line reason). Fail non-zero on a top-level
      directory in none of the three, with a message telling the author which list to add it to and why.
- [x] 2.4 Implement the enumeration skips from design.md Decision 1b: dot-prefixed directories and the hardcoded
      `IGNORED_TOP_LEVEL` set of exactly six names — `node_modules`, `dist`, `build`, `coverage`,
      `playwright-report`, `test-results`. Do NOT include `target` or `out`: `.gitignore:11` is the anchored
      `backend/target/` and `out` is absent, so neither is ignored at the repo root and both SHOULD trip the guard.
      Reproduce Decision 1b's name-to-`.gitignore`-line table in the script header, document why the set is
      hardcoded rather than parsed from `.gitignore` or resolved via `git check-ignore` and what that costs, and
      state in the table that a new unanchored root directory pattern added to `.gitignore` must be added here in
      the same commit.
- [x] 2.5 Populate `PARTIAL_COVERAGE` (`frontend`, `backend`) and `ACKNOWLEDGED_UNSCANNED` (`docs`, `e2e`, `infra`,
      `notes`, `openspec`, `schemas`, `scripts`) with real reasons, not placeholders.
- [x] 2.6 Verify the classification against the MAIN CHECKOUT's real top-level listing, not the worktree's. Note
      why the obvious method does not work: `repoRoot` is derived from `import.meta.url` (script line ~57), so
      running the worktree's script from the main checkout still scans the worktree, and running the main
      checkout's own copy runs the unmodified pre-change script with no guard at all — and the ticket forbids
      modifying the main checkout. Instead, export the classifier as a pure function that takes the list of
      top-level directory names as its argument (the gate's own `main` path calls it with the DIRECTORY-ONLY
      listing of the repo root — `readdirSync(root, { withFileTypes: true })` filtered to directories, since
      design.md 1c puts top-level *files* outside the guard's scope; the verification invocation must filter the
      same way or `README.md`/`package.json` would arrive unclassified —
      so the shipped code path and the verification path are the same function). Verify by invoking that export
      from the worktree over `readdirSync("/home/matt/Development/helio")`, printing the state assigned to each
      directory, and confirming nothing is unclassified — in particular that the main checkout's extra top-level
      `node_modules/` and `test-results/` are skipped by `IGNORED_TOP_LEVEL`. Nothing is written to the main
      checkout.
- [x] 2.7 Add the two "known residual limits" the guard does not cover, to the script header: top-level *files*
      and dot-directories (`.github`, `.husky`, `.claude`, `.concertino`) are outside the guard (design.md 1c).

## 3. Add the MCP surface and its secret-literal check

- [x] 3.1 Add the `mcp` surface: root `helio-mcp/`, excluding `node_modules/` and `dist/` and the binary extensions
      the fixture walk already skips; checks = secret-literal, bcrypt, email. Do NOT attach the credential-property
      ban or the import-graph walk (design.md Decision 3).
- [x] 3.2 Implement the secret-literal check per design.md Decision 4a — entropy-gated, NOT prefix-gated: a vendor
      prefix (`helio_pat_`, `sk-ant-`) followed by at least 20 characters of `[A-Za-z0-9_-]`, plus string literals
      of at least 8 characters assigned to identifiers whose name ends in `KEY`/`SECRET`/`TOKEN`/`PASSWORD`.
      Report file and line.
- [x] 3.2a Verify against Decision 4a's measured table that the check does NOT fire on any of: `config.ts:17`
      `const PAT_PREFIX = "helio_pat_"`, `queryParamsOrdering.test.ts:74` `pat: "helio_pat_test"`, or the
      `helio_pat_xxxxxxxx` / `helio_pat_…` placeholders in `helio-mcp/README.md` and `e2e/sleeper-rebuild.ts`, or
      `helio-mcp/src/config.ts:28` (`export HELIO_PAT=helio_pat_xxxxxxxx` inside a help string).
      None of these may be resolved by an exclusion, a marker annotation, or a rename of production code. Also
      verify it DOES fire on a synthetic `helio_pat_` + 64-hex value.
- [x] 3.3 Implement the synthetic-marker convention (design.md Decision 4.2) as the sole exemption path for the
      secret-literal check, documented in the header and named in the failure message. Add no new per-value
      allowlist entries.
- [x] 3.4 Add any `.test` TLD to the placeholder-domain convention (design.md Decision 4.1); document it as
      RFC 2606 reserved, alongside the existing `example.*`/`.invalid` entries.
- [x] 3.4a Fix the one pre-existing convention violation the widened scan finds (design.md Decision 4, measured):
      `helio-mcp/e2e/connector-authoring.ts:109` assigns `password: "correct horse battery staple 1!"` with no
      synthetic marker. Reword the literal to carry a marker (e.g. prefix it with `not-a-real-password `). The value
      is consumed only by that script's own `POST /api/auth/register` for a run-unique throwaway user, so the
      registration still works; confirm by reading the call site, and do NOT run the e2e script. Do not resolve this
      with an allowlist entry or an exclusion. Confirm the other six `*key|secret|token|password` literals
      (`restDataSourceSchema.test.ts:41,54,69,83,97`, `connectorSchema.test.ts:146`) pass untouched via the
      `should-never` marker.
- [x] 3.5 Run the gate standalone against the otherwise-unmodified tree with the widened surface in place —
      design.md's "first run" answer. Record the new count (expected around 82; confirm by measurement, do not
      assume). Triage every finding as a real leak (fix the file), a convention gap (fix the file to follow the
      convention), or a mis-specified literal shape (re-derive the Decision 4a bound from the measurement); never
      resolve one by widening an exclusion.

## 4. Prove the new coverage in the self-test

- [x] 4.1 Add a case that plants an obviously-synthetic credential-shaped literal in a dot-prefixed, selftest-named
      file under `helio-mcp/`, asserts the gate exits non-zero, removes it, and asserts the gate exits zero.
- [x] 4.2 Add a case that forces a declared surface to match zero files, per design.md Decision 5's concrete
      mechanism: temporarily rename `helio-mcp/` aside to `helio-mcp-hel956-selftest-moved/`, restored in `finally`
      and idempotently at self-test startup. Do NOT relocate `frontend/src/features/assistant`. Do NOT add an
      environment variable or any other self-test-only injection hook to the gate — the `SURFACES` table stays
      single and unconditional, or the Gate-Chain checklist's "reads no environment variable" answer becomes false.
- [x] 4.2a Assert on the expected MESSAGE TEXT, not merely a non-zero exit, in every red case. This matters
      specifically for 4.2: while `helio-mcp/` is renamed aside, the moved directory is itself an unacknowledged
      top-level directory, so the run would also fail the drift check — matching only on exit status would let the
      vacuity case pass while proving the wrong thing.
- [x] 4.2b Order the cases as design.md Decision 5 specifies — (1) `helio-mcp` secret literal, (2) drift probe,
      (3) `helio-mcp` rename — and assert a green baseline both before each plant and after each cleanup, so a case
      that leaks state fails locally instead of corrupting the next one.
- [x] 4.3 Add a case that plants an unacknowledged top-level directory `hel956-selftest-drift-probe/` — NOT
      dot-prefixed, or the guard skips it and the case is vacuously green (design.md Decision 5 / CR2) — and
      asserts the gate exits non-zero with the coverage-drift message. Remove it in `finally` AND idempotently at
      self-test startup, and add it (plus the `helio-mcp` planted file) to `.gitignore`.
- [x] 4.4 Confirm every planted artifact is removed on both the pass and fail paths — run the self-test, then run
      `git status --short` and confirm a clean tree. Then deliberately abort the self-test mid-run (or simulate a
      failing assertion) and confirm the startup cleanup recovers the tree on the next run.
- [x] 4.5 Deliberately break each new check in turn (mutation-style, reverted immediately) to confirm the
      corresponding self-test case actually goes red, so no case is vacuously green.

## 5. Verify and hand off

- [x] 5.1 Run `npm run check:no-credential-leak` and `npm run check:no-credential-leak:selftest`; both green.
- [x] 5.2 Run `npm run lint`, `npm run format:check`, `npm run typecheck`. Do NOT run Playwright or any e2e spec
      (HEL-972 holds the browser). Do NOT add a migration.
- [x] 5.3 Confirm no real credential appears anywhere in the diff; every planted value is obviously synthetic.
- [x] 5.4 Record the before/after scan counts (`16` -> N, with the per-surface breakdown) for the PR description,
      quoting both OK lines verbatim.
- [x] 5.5 Re-run task 2.6's classifier verification over the main checkout's top-level listing one final time
      after all edits, and confirm every directory is still classified. Use the same exported-function mechanism as
      2.6 — do not substitute "run the gate from over there", which measures the worktree.
