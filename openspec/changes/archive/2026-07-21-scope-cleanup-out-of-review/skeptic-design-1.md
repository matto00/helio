## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **`cmdSync` does not copy scripts (core premise of D4).**
   `grep -n "cmdSync\|copyAssets" /home/matt/Development/concertino/bin/concertino`
   shows `cmdSync` (line 1201) calls `copyAssets(out, dry, false)` (line 1212) —
   `withScripts=false`. `copyAssets` (line 458) only enters the `scripts/concertino/`
   copy loop `if (withScripts)`. Only `cmdInit` (line 1296) calls
   `copyAssets(out, false, true)`. Confirms the design's claim: today, a fix to
   `core/scripts/cleanup.sh` cannot reach a consuming repo via `concertino sync` —
   only via a fresh `init`. D4 (`copyAssets(out, dry, true)` in `cmdSync`) is
   therefore a real enabler, not scope creep, and is required for AC2 ("re-synced,
   not hand-edited").

2. **Global CLI is an independent copy, not a symlink.**
   `stat /usr/lib/node_modules/concertino/bin/concertino` vs.
   `/home/matt/Development/concertino/bin/concertino` → different inodes (30819434
   vs. 29375250) on the same device — a real second copy, not a link. Confirms
   tasks 2.1's instruction to invoke `node /home/matt/Development/concertino/bin/concertino
   sync --out <WORKTREE_PATH>` directly rather than the global `concertino` binary.

3. **Evaluator/skeptic currently have `Bash` and no `cleanup.sh` prohibition.**
   `adapters/claude-code/agents.json` baseTools include `Bash` for both `evaluator`
   and `skeptic` roles. `grep -n "cleanup.sh" core/roles/evaluator.md core/roles/skeptic.md`
   → no matches. Confirms the root-cause premise: the script is reachable and
   nothing today scopes it away.

4. **`assert-phase.sh cleanup` independently catches a forgotten `--phase4` flag.**
   Read `core/scripts/assert-phase.sh` lines 65–77: the `cleanup` phase check fails
   if `[ -d "$WORKTREE_PATH" ]` (worktree still present) or servers still answer
   health checks. This substantiates D1's stated self-correction path ("a legitimate
   Phase-4 call that forgot the flag still self-corrects... surfaces it") — it isn't
   hand-waved, it's grounded in an existing, already-wired check.

5. **Guard mechanism (D1) is a real technical control, independent of role-prompt
   compliance (D2/D3).** The `--phase4` flag / `CONCERTINO_PHASE4=1` sentinel is
   never mentioned anywhere in the evaluator/skeptic role templates per the tasks
   (1.4/1.5 add only a prohibition, not the override syntax) — so a rogue review
   agent that ignored the prohibition would still lack the opt-in and hit the
   no-op path. This means the fix defends against the actual failure mode (a
   review agent invoking the script) even if the "suspenders" (prompt-level
   prohibition) were somehow ignored — true belt-and-suspenders, not two copies of
   the same weak control.

6. **Current helio worktree state matches the ticket's premise.**
   `scripts/concertino/cleanup.sh` in this worktree is unguarded (identical to the
   concertino source's current `cleanup.sh`), and `.concertino.env` reads
   `concertino:sync v0.1.3`. This confirms the "before" state the design is
   describing is accurate, not stale/fabricated.

7. **AC ↔ task traceability.**
   - AC1 ("cannot destroy a live worktree... not invoked, or... guarded no-op") →
     tasks 1.2 (guard), 1.4/1.5 (prohibition), 3.2 (throwaway-worktree no-op test),
     3.3 (`--phase4` still works). Spec scenarios (spec.md lines 12–24) match.
   - AC2 ("fix made in Concertino source and re-synced") → section 1 (source repo
     branch/commit/PR), section 2 (helio regenerated via the dev bin + committed),
     task 2.2 (post-sync verification of guard/version/prohibition/flag presence).
   Both ACs are covered; no task exists without a traceable AC, and no AC is left
   uncovered.

8. **No placeholders/TBDs.** `design.md` Decisions D1–D5 are concrete (exact code
   change described for each: guard condition, `shift` semantics, exact
   `copyAssets` call-site edit, version string). `tasks.md` has no `TODO`/`TBD`/
   deferred-decision language. Risks section names concrete mitigations, not
   hand-waves.

### Non-blocking notes

- `proposal.md` ("What Changes") and `design.md` D5 both say the version bump lets
  "`upgrade`/`doctor` detect the change." Reading `cmdDoctor` (bin/concertino:737)
  shows it only checks runtime tooling (node/git/gh/claude/codex/MCP/playwright) —
  it does **not** check generated-file staleness at all. Only `cmdUpgrade`
  (bin/concertino:899) does that, and only via a single `concertino:sync v` marker
  regex against `.concertino.env` + `.claude/agents|commands` + `.codex/agents` —
  not per-script. The wording overstates what `doctor` does; harmless (no task
  depends on `doctor` behavior) but worth correcting before it's read as a spec by
  a future reader.
- `cmdDiff` (bin/concertino:843) never inspects `scripts/concertino/*.sh` at all —
  pre-existing and unaffected by this change, but means `concertino diff` will
  never show scripts as "changed"/"new" even after D4, only `sync`/`upgrade` will
  surface it. Fine for this ticket's scope; flag as a possible follow-up if script
  diff-preview parity is ever wanted.
- Section 1 has the executor branch and commit directly in the shared
  `~/Development/concertino` checkout (not a worktree). If another fleet run
  concurrently touches that same directory, there's a collision risk. Not this
  ticket's problem to solve, but the orchestrator should serialize concertino-repo
  work if this pattern recurs (matches the existing memory note on shared
  Playwright-session hazards during parallel worktree runs).

### Verdict: CONFIRM

The design's factual premises (sync/copyAssets behavior, global CLI independence,
current role-template gaps, assert-phase.sh self-correction path) are all verified
against the actual Concertino source, not merely asserted. The guard (D1) is a
genuine technical control that stops the specific failure mode (a review agent
invoking `cleanup.sh` mid-review) independent of whether the prompt-level
prohibition is honored, and the sync-propagation fix (D4) is a necessary enabler
the ticket itself requires, not scope drift. Both acceptance criteria trace
cleanly to concrete tasks and testable spec scenarios. No placeholders, no
internal contradictions between ticket/proposal/design/tasks/spec, no ambiguity a
competent implementer could misread. Sound to implement.
