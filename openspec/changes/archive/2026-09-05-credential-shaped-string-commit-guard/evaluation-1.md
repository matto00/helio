# Evaluation Report — Cycle 1 (evaluation-1.md)

## Phase 1: Spec Review — PASS

Issues: none.

- All four ACs addressed (see Phase 2 for my own re-verification of each).
- Constraints verified against `git diff --name-only origin/main..HEAD`: no Flyway
  migration, `.husky/pre-commit` untouched, root `jest.config`/`package.json`
  untouched (no new npm script — both `check:no-credential-leak` scripts already
  existed), no `frontend/**`/`backend/**` change. Diff is exactly the 15 files
  enumerated in `files-modified.md`.
- No artifact states or implies a credential ever leaked into committed history;
  every occurrence of the topic is explicitly framed as preventive hardening
  (`ticket.md`, `proposal.md`, `design.md`, `tasks.md` 10.4).
- Tasks in `tasks.md` all marked done and match what the diff implements.
- No scope creep. Spec delta `specs/agent-surface-credential-gate/spec.md` matches
  the implemented behavior.

## Phase 2: Code Review — FAIL

### Gates re-run by me (fresh, in `WORKTREE_PATH`, `CLEAN_WORKTREE` not set)

| Gate | Result |
| --- | --- |
| `npm run check:no-credential-leak` | OK (5988 files: 13 assistant-surface, 3 fixture, 66 mcp, 5883 delivery-evidence, 15 docs, 8 notes, 0 violations) |
| `npm run check:no-credential-leak:selftest` | OK |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run format:check` | All matched files use Prettier code style |
| `npm run check:openspec` | clean |
| `npm run check:schemas` | in sync |
| `npm run check:spec-structure` | passed (351 canonical specs, 0 issues) |
| `npm test` | 256 suites / 2650 tests + 24 suites / 238 tests, all passing |

### Mutation evidence — independently reproduced

I re-ran six of the claimed mutations myself; **all six reproduced exactly the
documented result**, message text included. Everything planted was removed and
`git status --short` was clean afterwards.

1. §5.1 vendor plant under `openspec/` → FAIL, exit 1, identical `file:line`
   message. Reproduced.
2. §5.2 `API_KEY=` + 44-char run → FAIL, exit 1, `identifier "API_KEY" is
   assigned a high-entropy credential-shaped value`. Reproduced.
3. §5.3 same plant with an underscore-separated marker (`..._should_never`) →
   green (5989 files, 0 violations), confirming `_`→`-` normalization. Reproduced.
4. §5.5 `deliverySecret` removed from the `needsText` disjunction on a mutated
   copy, plant present → silent OK, exit 0. Reproduced (confirms the disjunction
   is load-bearing, and the shipped file does include it).
5. §5.5 dispatch call disabled on a mutated copy, plant present → silent OK,
   exit 0. Reproduced.
6. §5.4 `delivery-evidence` `SURFACES` entry removed, plant present → FAIL with
   the COVERAGE DRIFT line only; the vendor violation is absent. Reproduced.

`mutation-evidence.md` is genuine executed transcript, not narration.

### Silence-reads-as-green wiring (priority 2) — verified in the shipped code

- `deliverySecret` is in `KNOWN_CHECKS` (`check-no-credential-in-agent-surface.mjs:245-252`),
  in the `needsText` disjunction (`:739`), and dispatched
  (`:753`). No HEL-956-CR1-class no-op.
- All three new surfaces resolve to non-zero files (5883/15/8 in the OK line), so
  the vacuity guard is satisfied non-trivially; the drift guard now classifies
  `openspec`/`docs`/`notes` as covered and their `ACKNOWLEDGED_UNSCANNED` entries
  are removed.
- `checkDeliverySecrets` resets `lastIndex` on both module-level `/g` regexes
  before iterating — no cross-file state leak.

### Decision 2a self-reference (priority 3) — verified

- The finished gate run against the finished change directory passes (the 0-violation
  run above scans this very directory, 5883 delivery-evidence files).
- `mutation-evidence.md` contains no unmarked credential-shaped value: every planted
  value is described by shape only, and every pasted stderr line is
  `file:line` + hint (the gate never echoes the matched value — confirmed by
  reading `checkSecretLiterals`/`checkDeliverySecrets`).
- No allowlist mechanism was added at all; the sole exemption path remains
  `isSyntheticSecretLiteral`. The plants were **not** weakened — I re-ran them
  unmarked and they go red.

### Acceptance criteria (priority 4) — verified myself

- (a) red-then-green: reproduced for both rules, above.
- (b) zero false positives on the real tree: gate is green over 5988 files.
  `helio_pat_xxxxxxxx` confirmed present at `helio-mcp/src/config.ts:28` and
  `helio-mcp/README.md:38` and passing; `helio_pat_<valid-token>` spec placeholders
  and the `sk-ant-SECRET-SHOULD-NEVER-LEAK-xyz` archive fixture all pass.
- (c) redact-and-revoke rule is in `CONTRIBUTING.md` (durable, tracked, not a render
  target), with the reasoning about render targets stated explicitly.
- (d) both `npm run check:no-credential-leak` and `...:selftest` are in the
  **frontend** job of `.github/workflows/ci.yml`; I parsed the YAML with `js-yaml`
  and enumerated `jobs.frontend.steps[].run` — both appear, in order, before
  `npm test`.

### No real credential (priority 6) — verified

Scanned the whole diff for `helio_pat_`/`sk-ant-` + ≥20 token chars: the only hits
are the `sk-ant-SECRET-SHOULD-NEVER-LEAK-xyz` reference (carries `should-never`) and
prose. Self-test plants are `"helio_pat_" + "a1b2c3d4e5f6".repeat(6)` and
`"a".repeat(44)` — obviously synthetic.

### Blocking defect

**CR1 below** — the self-test plants into the *in-flight change directory*, which
this delivery workflow's own archive step will move. That makes the newly-added
merge-blocking CI step crash. See Change Requests.

### Other code review checks

DRY (reuses `collectFiles`/`runChecksForSurface`/`VENDOR_PREFIX_SECRET_REGEX`
unchanged), readability (bounds are documented against measured ground truth),
modularity, error handling, no dead code, no over-engineering: all pass. Comment
quality is high and the "what this check does NOT catch" bound (`helio_session`
cookie in a curl transcript) is honestly stated rather than overclaimed.

## Phase 3: UI Review — N/A

**Deliberately skipped**, per the orchestrator's explicit instruction: another
worktree currently holds the Playwright session, and this is a build-tooling change
with zero UI surface (no `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`
change; the only `openspec/**` change is this change's own planning artifacts and
its non-UI spec delta). No dev server or backend was started; no e2e spec was run.

## Overall: FAIL

## Change Requests

1. **`scripts/check-no-credential-in-agent-surface.selftest.mjs:86-87` — the
   HEL-846 openspec plant path is tied to the in-flight change directory, and
   breaks the moment this change is archived.**

   ```js
   const openspecChangeDir = join(repoRoot, "openspec/changes/credential-shaped-string-commit-guard");
   const hel846OpenspecPlant = join(openspecChangeDir, ".hel846-plant.md");
   ```

   `/opsx-archive` moves that directory to
   `openspec/changes/archive/<date>-credential-shaped-string-commit-guard/` as a
   normal part of this very delivery workflow. Nothing `mkdirSync`s
   `openspecChangeDir`, so the `writeFileSync` at line 823 then throws.

   Measured, not reasoned: I renamed the change dir to its archive path and ran
   the self-test:

   ```
   Error: ENOENT: no such file or directory, open
     '.../openspec/changes/credential-shaped-string-commit-guard/.hel846-plant.md'
       at writeFileSync (node:fs:2430:20)
       at .../check-no-credential-in-agent-surface.selftest.mjs:796:5
   EXIT:1
   ```

   (Renamed back immediately; `git status --short` clean.) Because CR-(d) just
   made `npm run check:no-credential-leak:selftest` a merge-blocking CI step, this
   is a self-inflicted CI break with near-certain timing — and it fails as a crash,
   not as a check failure, which is the worst diagnostic shape.

   Required change: plant at a path that exists unconditionally and is not tied to
   a change name — `openspec/.hel846-plant.md` is inside the `delivery-evidence`
   surface root and always exists. I verified the gate detects a plant there:

   ```
   - openspec/.hel846-probe.md:2: contains a hardcoded vendor-prefixed credential-shaped literal — ...
   ```

   Update `.gitignore:78` from
   `/openspec/changes/credential-shaped-string-commit-guard/.hel846-plant.md` to
   the new path in the same commit (that entry has the identical staleness problem:
   after archive it stops matching, so a crashed run would leave a *committable*
   artifact carrying an unmarked credential-shaped value — exactly what this gate
   exists to prevent). Add a `mkdirSync(dirname(plant), { recursive: true })` or an
   `existsSync` precondition as a belt-and-braces guard, and re-run the archived-path
   simulation above as evidence.

## Non-blocking Suggestions

- `docs/.hel846-plant.md` and `notes/.hel846-plant.md` are fine (those roots are
  permanent), but they share the same unguarded-`writeFileSync` shape; the
  `mkdirSync`/precondition suggested in CR1 would cover all three uniformly.
- The `deliverySecret` high-entropy rule's `["']?` optional quote means a match can
  end mid-token when the value is quoted and contains a character outside the class;
  harmless for a detector (it only ever over-detects a prefix), but worth a line of
  comment so a future reader does not read the asymmetric optional quotes as a bug.
