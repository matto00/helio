## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/enforce-precommit-checks-in-ci/HEL-1123`.

- **Round-2 point 1 (proposal/design rule mismatch) — CLOSED.** `proposal.md`'s "What Changes"
  second bullet now states all three corrected elements verbatim: parses "both `npm run <script>`
  lines and bare npm-alias lines like `npm test`"; "resolves each script generically via
  `package.json`'s own `scripts` entries"; and compares against "only the jobs
  `.github/workflows/ci.yml`'s `ci-complete` job actually depends on (its `needs:` array) — not
  every workflow file". This matches `design.md` Decision 2's three sub-bullets and `tasks.md`
  3.1 (which restates the same three constraints). No file still describes the refuted round-1
  rule.

- **Round-2 point 2 (hook-line count) — CLOSED against ground truth.** `cat -n .husky/pre-commit`:
  lines 4–20 are 17 `npm run` invocations, line 21 is `npm test`, total 18 executed steps.
  (`grep -c "npm run"` returns 18 only because line 23's trailing comment mentions
  `npm run selftest:concertino-git-env`, which is deliberately not executed — the hook's own
  comment says so, and design.md's Exclusions bullet relies on exactly that.) `design.md:46`
  now reads "17 `npm run` lines + this 1 bare-alias line = 18 total" and `design.md:51` "all 18
  entries uniformly" — both correct.

- **`npm ci` removal — CLOSED.** `grep` for `npm ci` in `design.md`/`tasks.md`'s alias lists: the
  bare-alias enumeration is `npm test`/`npm start` in both (design.md Decision 2 bullet 1;
  tasks.md 3.1), and design.md explicitly annotates that `npm ci` is not a `package.json`-script
  alias. Correct per `package.json`'s `scripts` block (which defines `test` but no `start`;
  listing `start` is harmless forward-coverage, not a false claim).

- **Premise still true on this branch.** `grep` across `.github/workflows/*.yml` for
  `check:repo-integrity|check:scala-quality|check:schemas|check:spec-structure` and their
  underlying script paths (`check-repo-integrity.mjs`, `check-scala-quality.mjs`,
  `check-schema-drift.mjs`, `check-spec-structure.mjs`) returns **zero hits** — the four checks
  are genuinely unenforced in CI by either name or path.

- **No new gap introduced.** I traced all 18 hook entries against the post-change `frontend` job
  as designed (`ci.yml:13–96` + the four additions from task 2.1): `lint`, `typecheck`,
  `check:e2e-types`, `check:helio-mcp-types`, `format:check`, `check:dependabot[:selftest]`,
  `check:no-credential-leak[:selftest]`, `check:tokens[:selftest]`, `check:openspec[:selftest]`,
  `npm test` are already present (`ci.yml:28–96`); the four new ones close the remainder. The
  guard will therefore be satisfiable on the very diff that introduces it — no chicken-and-egg.
- **`ci-complete` scoping is accurate**: `ci.yml:406–408` is `ci-complete:` with
  `needs: [frontend, backend, security, e2e]`, so design Decision 1 / task 2.2's "no fifth entry
  needed" is correct as written.
- **Ordering constraint is real**: the pinned `openspec` CLI install is `ci.yml:84–87`, before
  `check:openspec` at 94 — placing `check:spec-structure` after those steps (design Decision 1)
  does inherit it.

### Verdict: CONFIRM

The two round-2 change requests are genuinely closed and consistent across all three artifacts,
and the design is unambiguous enough to implement.

### Non-blocking notes

- `design.md:54` still says the round-1 table "only handled 13 of 19 cases", a leftover of the
  old 19 count that contradicts "all 18 entries" three lines above it at :51. It is a
  parenthetical describing an already-rejected alternative and changes no implementable rule
  (the shipped rule is count-independent: resolve generically from `package.json`), so it is not
  blocking — but fold `19 → 18` into the execution commit for internal consistency.
- `npm start` is listed in the bare-alias set though `package.json` defines no `start` script.
  Harmless and arguably future-proof; just make sure the guard treats an alias with no matching
  `scripts` key as "not a hook step" rather than erroring.
