# HEL-997: Root `tsconfig.json` has no `include` and does not exclude `.claude/worktrees/`

## Description

**The ticket's original premise was refuted at the design gate and the ticket has been re-scoped by its owner.**

As filed, HEL-997 claimed that because root `tsconfig.json` declares no `include`, a bare `npx tsc --noEmit` at the
repo root would type-check every Concertino delivery worktree under `.claude/worktrees/`. The ticket's literal
facts were all true (no `include`; `exclude` lacks `.claude/worktrees`; nothing invokes a bare root `tsc`; the file
is untouched since the initial commit `190570d4`) — but the mechanism those facts were supposed to imply is false.

**TypeScript's wildcard globs never match path segments beginning with a dot.** `.claude/worktrees/` is already
structurally unreachable from a bare root `tsc`, with no change at all. Measured independently three times:

- Real repo root, live worktrees on disk, `npx tsc -p tsconfig.json --showConfig`: **687 files resolved, 0 under
  `.claude`.** (Reproduced by the orchestrator and by the ticket owner.)
- Scratch fixture shaped exactly like the shipped root config: the worktree file is not resolved with no `include`,
  and still not resolved with `include: ["**/*"]`. Only a literal `.claude/**/*` reaches it.

The consequence that mattered: the mutation check the ticket demanded — remove the guard, show worktree files are
picked up — **cannot go red**, because they are never picked up. Implemented as written, the predictable path is
that the red arm fails, the assertion is weakened until it passes, and a guard that proves nothing ships. That is
HEL-880's quiet second bug reproduced inside the fix for HEL-880's own cautionary tale.

## Re-scoped work (owner ruling: `rescope-regression-config-only`)

One real gap was found while refuting the premise. `e2e/tsconfig.json`'s include is
`["**/*.ts", "../playwright.config.ts"]` — it names `playwright.config.ts` explicitly but **not its sibling
`playwright.regression.config.ts`**, and a repo-wide grep finds no other config referencing that file. It is
type-checked by nothing.

## Acceptance Criteria

- `"../playwright.regression.config.ts"` is added to `e2e/tsconfig.json`'s `include`, beside its existing sibling
  entry.
- `npm run check:e2e-types` — a gate that actually runs, in `.husky/pre-commit` — passes, and demonstrably now
  covers `playwright.regression.config.ts` (shown via `--showConfig`, comparing before and after).
- No guard script, no root `tsc` invocation, no `exclude` additions. The refuted worktree-scoping story is not
  implemented. It is retained in the archived proposal and design only as an explicitly-labelled refutation with
  its measurements, so a future reader finds the number rather than re-deriving it.
- The PR does not restate the false premise as though it were real.

## Explicitly out of scope (owner ruling)

- **Do not file the 687-file root walk as its own ticket.** It is latent, nothing invokes that path, and the
  specific hazard people would fear about it (worktree leakage) has now been measured not to exist. The measurement
  is to be recorded in HEL-997's closing comment instead, with the `--showConfig` command, so the next person finds
  the number rather than re-deriving it.
- Any change to root `tsconfig.json`.

## Constraints

- **No database access of any kind.** HEL-974 holds the dev Postgres exclusively with an in-flight `V100`. Do not
  start a backend dev server, run a backend spec, or open any database connection.
- HEL-996 is live on `.github/workflows/ci.yml`. Do not edit that file; flag any collision.
- The live worktrees under `.claude/worktrees/` are read-only reproduction material. Do not modify or remove them.
