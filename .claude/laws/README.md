# Iron Laws

Canonical, dependency-free "law" documents that agents in the Helio
ticket-delivery workflow are **bound to read at the point of use**. Each law is a
hard, evidence-gated behavioral rule phrased as a refusal — the mechanism that
keeps the autonomous orchestration loop diligent and self-correcting when the
human is out of the loop.

The design rationale, full topology, and history live in
`notes/orchestration-iron-laws-handoff.md`.

## The laws

| File                                | Iron Law                                    | Bound to                     |
| ----------------------------------- | ------------------------------------------- | ---------------------------- |
| `systematic-debugging.md`           | No fix without a probe-confirmed root cause | executor                     |
| `verification-before-completion.md` | No completion claim without fresh evidence  | executor, evaluator, skeptic |

Two further canonical standards live at the repo root (repo-specific, so not in
this portable set) and are bound the same way:

- `CONTRIBUTING.md` — code-quality standard.
- `DESIGN.md` — design-language standard (the UI counterpart to CONTRIBUTING).

## How the mechanism works

1. **Canonical, re-read just-in-time.** Agents read the relevant law _at the
   moment they need it_, not from drifting/compacted memory. (This is the lever
   that empirically lifted code quality once agents were bound to CONTRIBUTING.md.)
2. **Evidence-gated transitions.** A claim ("tests pass", "root cause found",
   "ready to ship") requires a fresh, reproduced artifact — so a wrong step fails
   loudly instead of propagating silently.
3. **Cold, adversarial verification.** The Skeptic agent is spawned fresh at the
   gates and derives its verdict from ground truth, never from another agent's
   narrative — so it can't inherit the loop's blind spots.

## Acknowledgements / Prior Art

These laws are **inspired by [obra/superpowers](https://github.com/obra/superpowers)**,
a coding-agent methodology built around composable skills and hard behavioral
gates ("Iron Laws"). Superpowers is the source of the core insight this workflow
builds on: that evidence-gated refusals, re-read just-in-time, make an agent
self-correcting with the human out of the loop.

Specific inspirations (each law's frontmatter carries an `inspired_by` pointer):

| This repo                            | Inspired by superpowers skill                            |
| ------------------------------------ | -------------------------------------------------------- |
| `systematic-debugging.md`            | `systematic-debugging`                                   |
| `verification-before-completion.md`  | `verification-before-completion`                         |
| Skeptic design-soundness gate        | `brainstorming` (design-before-build) + spec self-review |
| Executor test discipline             | `test-driven-development`                                |
| Worktree setup scripts               | `using-git-worktrees`                                    |
| Evaluator / Skeptic two-stage review | `requesting-code-review` / `subagent-driven-development` |

**What is original here:** the _orchestration_ — the Linear + OpenSpec
integration, the worktree-per-ticket fleet model, the
executor/evaluator/Skeptic agent topology, the escalation taxonomy and
circuit-breaker budgets, and the cold-vs-warm reviewer split. Superpowers
provides laws and skills; it has no orchestrator. The laws are inspired-by; the
machine that runs them is this repo's own.

These laws were rewritten from scratch and tuned for Helio's stack — there is **no
runtime dependency** on superpowers. The goal is to roll this directory into a
standalone plugin; credit to superpowers travels with it.
