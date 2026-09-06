# Skeptic Report — design gate (round 1, skeptic-design-1.md)

## What I verified (with evidence)

### Design's factual claims — checked individually

| Claim (design.md Context / D1) | Verdict | Evidence |
| --- | --- | --- |
| Root `tsconfig.json` is entirely unreferenced; only `extends` is `helio-mcp/tsconfig.typecheck.json` → its sibling | **TRUE** | `grep -rn '"extends"' --include=*.json` over the tree (excl. `node_modules`, `.claude`) returns exactly one hit: `helio-mcp/tsconfig.typecheck.json:2`. |
| Only root-level `.ts` files are `playwright.config.ts` and `playwright.regression.config.ts` | **TRUE** | `ls *.ts` at worktree root. |
| `e2e/tsconfig.json` already includes `"../playwright.config.ts"` | **TRUE** | `cat e2e/tsconfig.json` → `"include": ["**/*.ts", "../playwright.config.ts"]`. |
| `playwright.regression.config.ts` is type-checked by nothing | **TRUE** | Not in the e2e include (which covers only `e2e/**/*.ts` plus that one named sibling); no other project references it. |
| D1-alt (a): `files: []` with no references raises **TS18003** | **FALSE (code wrong, substance right)** | Measured with the repo's own `tsc` 5.9.3: the error is **TS18002** — `The 'files' list in config file '…' is empty.` Exit 2. It does fail loudly, so the conclusion survives; the cited code does not. |
| D1-alt: "the HEL-880 hazard does not transfer literally to tsconfig globs" | **TRUE, but for the wrong reason — and it masks a fatal finding** | See below. |

### The central premise of the ticket is FALSE (reproduced twice)

TypeScript's wildcard/default include **never matches path segments beginning with a dot**. `.claude/worktrees/`
is therefore already structurally unreachable from a bare root `tsc` — today, with no change at all.

Probe 1 — scratch fixture (`tsc` 5.9.3, the repo's own binary), config identical in shape to the shipped root
config (no `include`, same `exclude` list), containing `root.ts`, `plain/nested/p.ts` and
`.claude/worktrees/foo/w.ts`:

```
FILES: ['./root.ts', './plain/nested/p.ts']        # no include  -> .claude/** NOT walked
FILES: ['./root.ts', './plain/nested/p.ts']        # include ["**/*"] -> still NOT walked
FILES: ['./.claude/worktrees/foo/w.ts']            # include [".claude/**/*"] -> only a literal dot segment reaches it
```

Probe 2 — the **real** repo root, with five live worktrees on disk
(`bug/rls-independent-zero-root-guard`, `task/harden-nodepath-wiring-guard`, `task/matt-audit-repo`,
`task/root-tsconfig-worktree-scope`, `task/wire-selftests-into-ci`), read-only `--showConfig`:

```
total resolved files: 687
under .claude:        0
```

Zero. The scenario the ticket describes — "a bare `npx tsc --noEmit` at the repo root would type-check every
Concertino delivery worktree" — does not occur and cannot occur without someone adding a literal `.claude`
segment to `include`. Both probes agree; the result is stable, not a tooling anomaly.

What *is* true: a bare root `tsc` resolves **687** files across `frontend/`, `e2e/`, `helio-mcp/` etc. under an
unrelated `compilerOptions` set. That is a real (still latent) breadth issue — but it is a different issue from
the one the ticket, proposal and design are all written about.

## Verdict: REFUTE

The design is internally coherent but rests on a premise that ground truth refutes. Implementing it as written
produces a guard against a hazard that does not exist, an "anchored exclude" that excludes nothing, and — most
seriously — a mutation selftest whose red arm **cannot go red**, which is precisely the HEL-880 class of failure
(a guard that looks like evidence and proves nothing) that this ticket exists to avoid repeating.

## Change Requests

1. **Correct the premise before anything else, and escalate it.** The ticket's stated mechanism is false:
   `.claude/worktrees/` is already unreachable from a bare root `tsc` because TS wildcard globs skip dot-prefixed
   segments (evidence above, two independent probes). `proposal.md` — Why, and `design.md` — Context must be
   rewritten to state this, and the ticket owner must rule on whether HEL-997 should be **closed as
   not-a-defect** or **re-scoped** to the two real findings (the 687-file walk under a stray `compilerOptions`
   set, and `playwright.regression.config.ts` being type-checked by nothing). Do not implement the current plan
   pending that ruling.

2. **D2's selftest is not implementable as specified — remove or redesign it.** Its mutation arm asserts that a
   config with `include` removed *DOES* resolve a `.claude/worktrees/` fixture file. Measured: it does **not**
   (Probe 1, line 1). Written as specified, task 3.2(a) fails outright; the likely executor response is to weaken
   the assertion until it passes, which ships exactly HEL-880's quiet second bug. If any guard survives CR‑1, its
   red arm must be re-derived from measured behaviour, not from the assumed one.

3. **Drop task 2.2 (`".claude/worktrees"` added to `exclude`) or justify it honestly.** It is a no-op: the path is
   already unreachable, so it excludes nothing and cannot be shown to exclude anything. Calling it "defence in
   depth" gives a false impression of protection. If retained, it must be labelled as documentation-of-intent,
   not as a guard.

4. **Tasks 1.1/1.2 and 5.1 demand evidence that cannot truthfully be produced.** 5.1 requires "worktree files
   resolved with the guard removed … from the repo root **and** from inside a worktree (four measurements)". The
   two "guard removed" measurements will both be zero. Rewrite these tasks so the executor is not placed in a
   position where the only way to satisfy the checklist is to fabricate a red baseline.

5. **Fix D1-alternative (a): the error is TS18002, not TS18003.** Measured output quoted above. The rejection of
   `files: []` still stands on substance, but the design instructs the executor to raise a contradiction with (a)
   — pre-empt that by correcting it now.

6. **Withdraw or qualify D1-alternative rationale (b), "it forfeits the one real win — `playwright.regression.config.ts`
   gains type coverage."** Under this change's own non-goals ("Adding a root `tsc` invocation to `package.json`,
   `.husky/pre-commit`, or CI" is excluded) nothing ever runs root `tsc`, and D2's guard runs only
   `--showConfig`, which performs no type checking. The file would be checked exactly once, by hand, during
   implementation, then revert to being checked by nothing. If durable coverage for that file is the goal, it
   needs its own mechanism (e.g. adding it to `e2e/tsconfig.json`'s include next to its sibling) — which is a
   smaller, honest change and may be the whole ticket.

## Non-blocking notes

- Adding `"../playwright.regression.config.ts"` to `e2e/tsconfig.json`'s `include` — one line, mirroring the
  existing `"../playwright.config.ts"` entry — would deliver the only concrete win identified here under a gate
  that actually runs (`check:e2e-types`). Worth considering as the re-scoped ticket.
- The 687-file root walk is worth recording somewhere even if HEL-997 closes, since it is the true (if harmless)
  form of the "root config is unscoped" observation.
