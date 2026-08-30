## Context

`scripts/concertino/` is a *render target*: `concertino sync` writes it from Concertino's `core/` templates. It is also the toolset every delivery agent shells out to. Those two facts pull in opposite directions, and the repo has so far resolved the tension by ignoring the directory and force-adding an arbitrary 8 files.

Two constraints shape the approach:

- `readlink -f "$(which concertino)"` resolves to `/home/matt/Development/concertino/bin/concertino` — the working checkout — so CON-148's `cleanup.skipSync` behaviour is live now with no release wait.
- `scripts/concertino/cleanup.sh` reads `CONCERTINO_CLEANUP_SKIP_SYNC` (line ~501) and, when truthy, skips the automatic `concertino sync --out=$REPO_ROOT` that otherwise fires on a successful Phase-4 fast-forward.

The change modifies the machinery the delivery run itself executes on, in a repo currently working through a multi-ticket batch. A mistake does not fail one ticket; it degrades every subsequent one.

## Goals / Non-Goals

**Goals:**

- Every delivery script a run invokes is present in a freshly created worktree, verified by measurement on a real worktree.
- Automatic mid-run rendering is off, durably, surviving arbitrarily many re-renders.
- The render-vs-edit contract is written where an executor will actually read it.
- The two stray artifacts are excluded by an explicit, self-documenting rule rather than by silence.

**Non-Goals:**

- Changing `setup-worktree.sh`. Explicitly rejected — see Decision 3.
- Un-ignoring `.concertino/`.
- Any change to Concertino's `core/` templates. CON-148 already shipped what was needed.
- Making rendered scripts editable in helio. The opposite is the point.

## Decisions

### Decision 1 — Track the scripts rather than copy them into worktrees

Git worktrees materialize tracked files by construction, so tracking is a zero-mechanism fix: no copy step, no drift between root and worktree, no new failure mode. The five absorbed duplicates proposed two rival fixes (copy vs. track); tracking subsumes copying, and the consolidation note's request to "confirm that reasoning holds" is discharged by the AC1 measurement — a fresh worktree listing after the change, not an inference from `.gitignore`.

### Decision 2 — Express `skipSync` as config, so the render produces its own gate

The obvious home for `CONCERTINO_CLEANUP_SKIP_SYNC=1` is `.concertino.env`, but that file is a render output: a hand-written line there is erased by the next `concertino sync`. That is precisely why the ticket said "work out the right place."

CON-148's resolution inverts the problem. Setting `"cleanup": { "skipSync": true }` in the hand-authored, tracked `concertino.config.json` makes the env line an *output* of the render. It cannot be erased by a re-render, because a re-render is what writes it. Verification therefore has to be render-idempotence, not file inspection: run `concertino sync` twice and confirm the key survives (AC3). A unit test upstream cannot establish this for helio's own config; only running it here can.

Rejected alternatives:

- **Hand-edit `.concertino.env`** — erased by the next render. This is exactly the failure the ticket flags.
- **Export the env var from a shell profile or `direnv`** — machine-specific, invisible to a fresh clone or a CI checkout, and not reviewable in a diff.
- **Patch the rendered `cleanup.sh` in helio** — the CON-133 failure mode verbatim: a local edit to a rendered file, erased by the next sync.

### Decision 3 — Do not touch `setup-worktree.sh`

The rejected copy-the-directory alternative would add logic to the script implicated in the 2026-08-21 repo-bricking incident. Stating this explicitly so it is not silently resurrected: Decision 1 makes copying unnecessary, and any future proposal to add copy logic there must argue against this record rather than around it.

### Decision 4 — Ordering: `skipSync` in effect strictly before tracking

If `.gitignore` is relaxed while auto-sync is still on, the next `cleanup.sh --phase4` renders into a now-tracked tree and leaves uncommitted changes under `scripts/concertino/`; the following ticket's `git add -A` sweeps them into an unrelated PR. That is silent cross-ticket corruption, and it is invisible in the PR that causes it.

So the implementation order is: edit config → `concertino sync` → verify the env line → only then relax `.gitignore` and `git add`. Within a single commit the ordering is not observable, but the *working-tree* ordering during implementation is what matters, because a cleanup run may fire in between.

### Decision 5 — Exclude the strays by negative pattern, not by omission

`pricing-table.json` and `report-cost.sh` are excluded (this is a settled decision carried in from the escalation that preceded this run, recorded in AC6). The mechanism is negative `.gitignore` patterns inside the Concertino block, with a comment naming why, rather than simply not `git add`-ing them. An un-added file is indistinguishable from an oversight and will be re-proposed on the next render; an explicit ignore rule with a rationale is a durable answer that survives the person who made it.

### Decision 6 — Resolve `concertino.config.json`'s `.gitignore` line

The file is already tracked (force-added) while listed in `.gitignore`. That combination means a real edit to it is invisible to `git status` and easy to lose. Since Decision 2 makes this file the load-bearing home of the `skipSync` gate, the stale ignore line is removed so the file behaves like the tracked, reviewable config it already is. Bookkeeping, not a fork in the design.

### Decision 7 — Documentation lands in two places

`scripts/concertino/README.md` is itself a rendered artifact, so helio-specific prose added there is erased on the next sync. `CLAUDE.md` is hand-authored and is the canonical-standards entry point agents already read. Therefore the durable statement of the contract lives in `CLAUDE.md`; the README may carry a pointer only if the rendered upstream text already accommodates one. AC5 is satisfied by `CLAUDE.md`.

## Risks / Trade-offs

- **Self-modification.** This change alters the tooling the run executes on. Mitigation: the ordering in Decision 4, and verification on a real second worktree rather than the one doing the work.
- **Newly exposing something private.** Tracking 15 previously-ignored files could publish a secret or a machine-specific path. Verified by enumeration before proceeding: `grep -rn "/home/matt\|/Users/"` over the directory returns nothing, and every credential-shaped grep hit is prose in a comment or an Anthropic usage-field name. Re-verified during this change rather than inherited from the prior run.
- **Rendered scripts become committable by accident.** The cost of Decision 1: a careless `git add -A` can now commit a local edit to a rendered file. Accepted, and answered by Decision 7's documentation plus the fact that `skipSync` removes the main source of unexpected render churn.
- **Manual sync becomes a required habit.** Renders no longer happen automatically at Phase 4, so a Concertino upgrade reaches helio only when someone runs `concertino sync`. This is the intended trade: a render's diff is now always its own reviewable commit.
- **The jest gate is vacuous inside a delivery worktree** (HEL-880, open). A green root `npm test` in the worktree is not evidence for this change, and none of its acceptance criteria rely on it — every AC is verified by direct measurement instead.
