## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit `aed98849` on `task/close-typecheck-gate-gap/HEL-683`, base `8432f280`.
Cold review: every conclusion below comes from a command I ran myself in the worktree.
I read `evaluation-1.md` and the design artifacts as **claims**, then re-derived each one.
No UI surface exists in this diff (`package.json` script, `tsconfig.json` `include`, hook,
workflow, docs) — no dev server started, no Playwright, per the orchestrator's instruction
and the diff's own content.

### The central question: can this gate actually go red?

I attacked this from five angles. It survived all five.

**1. Script leg — real type error in a real module (my own probe, different file from the
executor's and the evaluator's).** Appended to `frontend/src/config/env.ts` (a module Jest
*never compiles* — `jest.config.cjs`'s `moduleNameMapper` maps `^.*/config/env$` to
`envMock.ts`, so this is precisely the un-test-imported surface the ticket is about):

```
export const SKEPTIC_PROBE: number = "definitely-not-a-number";
```

```
$ npm run typecheck            # from repo root
> npm --prefix frontend run typecheck
> tsc --noEmit
src/config/env.ts(13,14): error TS2322: Type 'string' is not assignable to type 'number'.
ROOT_TYPECHECK_EXIT=2
```

Exit code 2 propagates through **both** npm layers (root passthrough → frontend script → tsc).
`npm run typecheck` from inside `frontend/` also exits 0 on a clean tree (`FRONTEND_DIR_EXIT=0`),
so both documented invocations work.

**2. The other pre-existing frontend gate is blind to this defect** — so the new gate is not
redundant decoration. With the same probe in place:

```
$ npm run lint    →  LINT_EXIT=0     (eslint . --max-warnings=0, clean)
```

ESLint passes on a hard type error. Only `typecheck` catches it.

**3. Pre-commit leg — a REAL `git commit`, not a hand-invoked script.** This is the angle the
brief flagged as not fully closed. `core.hooksPath=.husky/_`, a *relative* path, and this is a
linked git worktree — so I tested that resolution rather than assuming it:

```
$ git add frontend/src/config/env.ts
$ git commit -m "SKEPTIC PROBE HEL-683 - this commit MUST be rejected by the pre-commit hook"
> helio@1.0.0 lint            → (no errors)
> helio@1.0.0 typecheck
> tsc --noEmit
src/config/env.ts(13,14): error TS2322: Type 'string' is not assignable to type 'number'.
husky - pre-commit script failed (code 2)
COMMIT_EXIT=1
HEAD_BEFORE=aed98849c4182a15066576a8c66857c08dc9b4b8
HEAD_AFTER =aed98849c4182a15066576a8c66857c08dc9b4b8   SAME_HEAD=YES
```

The hook fires on a real commit inside the worktree, `set -e` aborts at **step 2 (typecheck)**
before `format:check` ever runs — unambiguous attribution — and **no commit object was created**.

**4. Green after revert, tree provably pristine.** `git checkout -- frontend/src/config/env.ts`,
then `sha256sum` back to the pre-probe value `9cfcf92a…5488`, `git status --porcelain` back to
its exact starting state (` M workflow-state.md`, `?? evaluation-1.md` — both pre-existing before
I touched anything), and `npm run typecheck` → **exit 0**.

**5. Is there any path by which `tsc` resolves to something that always exits 0?** I could not
find one:
- `frontend/node_modules/.bin/tsc → ../typescript/bin/tsc`, TypeScript **5.9.3**, a declared
  `devDependency` of `frontend/package.json` (and already required by `ts-jest`, so the hook
  gains no new install prerequisite — root `npm test` already shells into `npm --prefix frontend`).
- **Missing toolchain fails loudly, never silently green.** I built a throwaway tree with the
  identical two-layer script wiring, a type error, and *no* `node_modules` anywhere
  (`command -v tsc` → NONE): `sh: tsc: command not found` → **exit 127**. Red, not green.
- `--noEmit` still reports and still exits non-zero (observed, twice).
- No `|| true`, no `continue-on-error`, no `--silent`, no `set +e` anywhere in the chain
  (`.husky/pre-commit` is `set -e` + seven bare `npm run` lines).

**CI leg.** `ci.yml` parses (`python3 -c "import yaml"`); `jobs.frontend.steps` is exactly
`npm ci`, `npm --prefix frontend ci`, `npm run lint`, **`npm run typecheck`**, `npm run
format:check`, `npm test`; the step's only key is `run`; no `continue-on-error` / `if:` /
`|| true` on the step or the job; no typecheck step under `jobs.backend`. Frontend deps are
installed before the step runs, so the 127 path cannot occur in CI. GitHub's own
"non-zero step exit fails the job" semantics I cannot observe without pushing a deliberately
broken PR, which this change correctly refuses to do — and the artifacts label that leg
**inferred**, never observed (design D5, spec.md, commit body, `DELIVERY_OBLIGATIONS`). That
labelling is accurate.

### Coverage: is the gate's real scope its advertised scope?

- `tsc --noEmit --listFiles` puts **581** `frontend/src` files in the program; `git ls-files src`
  counts **581** tracked `.ts`/`.tsx`. Exact parity — no blind spot inside `src` (372 `.tsx`).
- `vite.config.ts` and `pwa-assets.config.ts` are both **in the program**, not merely named.
- `git ls-files frontend | grep -E '\.(ts|tsx)$' | grep -v '^frontend/src/'` returns exactly those
  two files, so D4's "the widening is complete" is true as of this commit.
- **The `include` change is load-bearing, not cosmetic** — my own counterfactual: with type errors
  injected into both config files, the committed `include` gives `NEW_EXIT=2` (TS2322 for each);
  a temporary config restoring the base's `["src", "tests"]` with the *identical* errors present
  gives `OLD_EXIT=0`. The base config is provably blind. Dropping the phantom `tests` entry is
  correct: `frontend/tests` does not exist, and a phantom entry is exactly the "advertised scope
  exceeds real scope" defect this ticket exists to end. Probe files restored (`sha256sum` verified),
  temporary config deleted.

### Acceptance criteria, traced

| AC | Evidence |
| --- | --- |
| 1. `npx tsc --noEmit -p frontend` exits clean | Ran the literal command from repo root: **exit 0**. Honestly disclosed as already-satisfied: this diff touches **zero** `frontend/src` files (`git diff --name-only 8432f280...HEAD` has no `src`/test/e2e entries), and that is stated in `ticket.md`'s provenance note, `design.md` Context, `files-modified.md`'s "Not modified" section, `proposal.md`'s Non-goals, **and** the commit body. The disclosure is complete, not buried. |
| 2. Gate enforced (pre-commit and/or CI) | Both. Verified live above. |
| 3. Proven to fail on a real type error | Verified by me independently, three ways (script, real `git commit`, `include` counterfactual). |
| 4. No behavioral change; tests pass unmodified | No `frontend/src` and no `*.test.*` file in the diff; `npm test` → **254 suites / 2751 tests passed, exit 0**; `npm --prefix frontend run build` → **exit 0** (`include` governs `tsc` only; Vite transpiles via esbuild). |
| 5. Lint/format/tests clean | `npm run lint` **0**, `npm run format:check` **0** ("All matched files use Prettier code style!"), `npm test` **0**. |

`npm run check:openspec` exits 1 with `change close-type-check-gate is complete (27/27) but not
archived` — reproduced; the known HEL-657 false positive the orchestrator's Phase 3 archive clears.
The `git commit -n` is disclosed in the commit body with a per-step enumeration, satisfying
`CONTRIBUTING.md:153`.

Fences respected: `git diff --name-only 8432f280...HEAD -- openspec/specs scripts/check-openspec-hygiene.mjs`
is empty; I edited nothing anywhere, and `git ls-remote origin main` is still `8432f280`, so CON-129's
pre-gate merge is a genuine no-op (nothing to integrate), not a skipped step.

### Docs: do they now tell the truth?

I re-swept independently with a *different* pattern than task 5.5 used (`git grep -n "npm run lint"`,
excluding archives/specs/node_modules) rather than re-running theirs.

- `CONTRIBUTING.md:113-121` enumerates the hook **line-for-line and in hook order** (lint, typecheck,
  format:check, check:schemas, check:openspec, check:scala-quality, test). Matches `.husky/pre-commit`
  exactly.
- `CLAUDE.md` at both sites: the command list (`npm run typecheck # tsc --noEmit against
  frontend/tsconfig.json`) and the prose section, which previously said only "ESLint, Prettier, and
  Jest" — a real pre-existing understatement — and now names all seven steps in hook order. Fixing
  that prose was in scope and is the honest call.
- `README.md` and `.cursor/skills/linear-ticket-delivery/SKILL.md` frontend gate lists updated.
- The `typecheck` script name reuses `helio-mcp`'s existing vocabulary rather than inventing a second.

### Do the artifacts overclaim?

I went looking for overclaim and found the three deferred gaps stated plainly, in multiple places
each, in language that does not soften them:

1. **`concertino.config.json` gates still lack typecheck** — confirmed by reading the file
   (`lint`/`format:check`/`test`/`build` only), and so do the rendered
   `.claude/agents/concertino-{executor,evaluator}.md:95-98/115-118`. Named in design D6, tasks 5.5,
   `files-modified.md`, and the commit body, with the reason (`concertino sync` disallowed by CON-128)
   and the anti-drift argument for not hand-editing rendered files. Not buried.
2. **Capability never reaches `openspec/specs/`** (`--skip-specs`, HEL-775 owns that tree) — design D7
   states the consequence explicitly, including that a later MODIFIED delta would abort `openspec archive`.
3. **CI redness inferred, never observed** — labelled as such in D5, spec.md, the commit body, and
   carried as a durable `DELIVERY_OBLIGATIONS` entry rather than as prose that dies at archive.

Everything the artifacts assert that I could check, checked out. Nothing I verified contradicted them.
The one wording I'd tighten is a non-blocking note below.

### Verdict: CONFIRM

The deliverable is a gate that can actually fail, and I made it fail — in a real `git commit`, in a
module no test compiles, with the commit rejected and `HEAD` unmoved. I could not find a decorative
path: no swallowed exit code, no always-green resolution, no wrong-job placement, no phantom coverage.
The tree is byte-identical to how I found it (`git status` matches its starting state; all probe files
`sha256sum`-verified restored; no stray files left).

### Non-blocking notes

1. **`include` is correct today but not self-maintaining.** `["src", "vite.config.ts",
   "pwa-assets.config.ts"]` must be hand-extended if anyone adds, say, `frontend/vitest.config.ts` —
   a quiet re-opening of the exact "advertised scope > real scope" hole D4 just closed. I verified
   `["src", "*.ts"]` is equivalent today (both config files in the program, exit 0) and would cover
   future root-level frontend TS automatically. Worth considering later; not a defect in this diff.
2. **One live hit escaped task 5.5's sweep pattern.** `.github/PULL_REQUEST_TEMPLATE.md:11` —
   `- [ ] Lint and tests pass (\`npm run lint && npm test\`)` — contains none of
   `format:check|check:scala-quality|Husky|pre-commit`, so no update-or-exempt decision was recorded
   for it. It is exempt-consistent with the other categorical hits (it was already non-exhaustive,
   omitting `format:check`/`check:schemas`/etc.), so nothing shipped is untrue — but 5.5 claimed a
   decision for *every* live hit, and this one was never seen.
3. **`proposal.md`'s "Update every live enumeration of the gate set … so no canonical doc understates
   it"** is a hair stronger than D6's own exemption: the rendered agent definitions *do* enumerate the
   frontend gate set and now understate it. The design, tasks, `files-modified.md` and commit body all
   disclose this, so the artifact set as a whole is honest; "every hand-maintained enumeration" would
   make the proposal sentence match D6.
4. **Adjacent TypeScript still ungated** (declared non-goals, worth follow-up tickets): `e2e/*.spec.ts`
   + `playwright.config.ts` (the root `tsconfig.json` is unusable as a gate — no `include`,
   `commonjs`/`node` resolution) and `helio-mcp`, which *already has* a `typecheck` script that nothing
   runs. `e2e/` is the most likely next place a type error lands silently.
5. **Delivery obligation is real work, not a checkbox.** D5(b) — confirming from the run log that the
   step actually executed, then read-modify-write appending the result to the PR body — is the only
   leg of the gate nobody has observed. The `DELIVERY_OBLIGATIONS` block spells out the exact `gh`
   sequence and warns that `gh pr edit --body` replaces rather than appends; it needs to actually be
   performed at Phase 3.
6. **`scripts/concertino/{next-report-number,persist-evidence,emit-event}.sh` are absent from this
   worktree's checkout** (untracked in main), so I invoked them from the main repo path, as the
   evaluator did. Unrelated to this diff; the agent-called scripts being untracked is a hygiene issue
   worth its own commit.
