## Evaluation Report — Cycle 1 (evaluation-1.md)

Judged against the **re-scoped** acceptance criteria in `ticket.md` (owner ruling
`rescope-regression-config-only`), not the original filing.

### Phase 1: Spec Review — PASS

Issues: none.

- AC1 — `"../playwright.regression.config.ts"` added to `e2e/tsconfig.json`'s `include`, beside its
  existing sibling entry. Verified in the diff; it is the sole code line changed.
- AC2 — Coverage change proven by `--showConfig`, independently re-measured by me (see Phase 2).
- AC3 — No guard script, no root `tsc` invocation, no `exclude` addition. `git diff main...HEAD --
  tsconfig.json .husky package.json .github` is **0 lines**. Root `tsconfig.json` untouched; no
  collision with HEL-996 on `.github/workflows/ci.yml`.
- AC4 — No artifact restates the false premise as real. Every occurrence of the worktree-walk claim
  across `ticket.md`, `proposal.md`, `tasks.md`, `skeptic-design-1.md` is explicitly labelled as
  refuted and carries the measurement (687 files, 0 under `.claude`). The commit message states only
  the before/after counts and makes no premise claim.
- Out-of-scope items respected: the 687-file root walk was not filed as a ticket; root tsconfig
  untouched.
- All 9 task items are checked and match what was implemented. No scope creep: the only non-artifact
  file in the diff is `e2e/tsconfig.json`.

### Phase 2: Code Review — PASS

**Load-bearing independent measurement (the point of this ticket).** A green
`check:e2e-types` proves nothing here, so I measured the resolved input set directly, from
TypeScript's own resolver, on both sides:

Before — `main` checkout (`/home/matt/Development/helio`), pre-change `e2e/tsconfig.json`
(`include: ["**/*.ts", "../playwright.config.ts"]`):

```
npx tsc -p e2e/tsconfig.json --showConfig | grep -c 'regression\.config'
0
```

After — branch `task/root-tsconfig-worktree-scope/HEL-997` @ `4cd6b6df`:

```
npx tsc -p e2e/tsconfig.json --showConfig | grep -c 'regression\.config'
2
```

The 2 hits are one in the resolved `files` array and one in `include` — confirmed by reading the
`--showConfig` output directly:

```
        "./support/touchTargetProbe.ts",
        "../playwright.config.ts",
        "../playwright.regression.config.ts"      <-- resolved `files`
    ],
    "include": [
        "**/*.ts",
        "../playwright.config.ts",
        "../playwright.regression.config.ts"
    ]
```

So the file is genuinely in the project's **resolved input set** now and demonstrably was not
before. This is the discriminating evidence the ticket demanded, reproduced by me rather than taken
from the executor's report.

**Gates re-run by me, fresh, in `WORKTREE_PATH`:**

- `npm run check:e2e-types` — exit 0 (`tsc --noEmit -p e2e/tsconfig.json`). The newly-covered file
  compiles clean, so design D3 holds and the include was not narrowed.
- `npm run format:check` — "All matched files use Prettier code style!"
- `git status --porcelain` — clean; no stray probe files left behind by the executor.

**Gates deliberately skipped, with reasons:**

- Backend (`cd backend && sbt test`) — **skipped**. No `backend/**` file is in the diff, and the
  orchestrator's hard constraint forbids any database connection: HEL-974 holds the dev Postgres
  exclusively with an in-flight `V100` migration. Running it would risk another run's migration
  state for zero review value.
- Frontend `npm run lint` / `npm test` / `npm --prefix frontend run build` — **skipped**. No
  `frontend/**` file changed; the changed file is a build-tooling config whose only consumer is
  `check:e2e-types`, which I ran.
- `.github/workflows/ci.yml` untouched and not exercised (HEL-996 live there).

Code-quality review of the one-line diff: it follows the established local pattern (D1) — the
sibling `../playwright.config.ts` entry — restoring symmetry rather than introducing a second
project. No duplication, no dead code, no abstraction, no type-safety or security surface. Nothing
to flag under `CONTRIBUTING.md`. `DESIGN.md` is not binding (no `frontend/**` change).

Issues: none.

### Phase 3: UI Review — N/A

No UI-affecting file changed. The diff touches `e2e/tsconfig.json` and change artifacts only — no
`frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**`. No dev server started,
no browser run (also required by the orchestrator's hard constraints).

### Overall: PASS

### Non-blocking Suggestions

- `ticket.md`'s third AC says the refuted story "is not preserved in the archived proposal or
  design", while the same bullet then says it *is* retained as a labelled refutation. The artifacts
  do the right thing (a future reader finds the 687/0 measurement rather than re-deriving it); the
  AC wording could be tightened at archive time. Already noted by the skeptic in round 2; not a
  defect in the implementation.
- Task 3.3 claims the full pre-commit chain ran green. I could not re-verify the backend-touching
  portion of that chain under the no-database constraint. This does not affect the verdict — the
  changed file cannot influence any backend gate — but the claim is unverified rather than
  independently confirmed, and is recorded as such.
