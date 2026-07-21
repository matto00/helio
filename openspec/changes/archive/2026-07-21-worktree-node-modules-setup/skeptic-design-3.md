## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `specs/concertino-worktree-setup/spec.md`,
  `tasks.md`, `workflow-state.md`, and both prior reports `skeptic-design-1.md` /
  `skeptic-design-2.md` (treated as claims, re-verified independently, not trusted).
- `workflow-state.md`: `DESIGN_GATE_ROUND: 3`, `LAST_SKEPTIC_VERDICT: REFUTE (design r2 —
  mechanism sound; fixed residual symlink language in proposal/design)` — matches the
  brief.
- **Grep sweep for every remaining "symlink"/"ln -s" mention across all five artifacts**
  (`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/concertino-worktree-setup/spec.md`):
  - `proposal.md:16` — "...a plain symlink is rejected because a worktree `npm ci`
    through it destroys..." → explicitly-rejected framing. Fixed since round 2.
  - `design.md:12,38-40,79,102` — all either explain *why* the symlink option was
    rejected (round-1 empirical finding) or restate the rejection in the Planner Notes'
    change-history line. No mention frames symlink as the chosen mechanism.
  - `tasks.md:8,23` — both mentions are parenthetical warnings ("NOT a symlink — a
    symlink into the main checkout is destructive...", "...the failure mode the symlink
    approach had") attached to tasks that specify the hardlink-copy (`cp -al`) mechanism.
  - `specs/concertino-worktree-setup/spec.md:33-34,51` — the requirement text is an
    explicit prohibition ("MUST NOT create a symlink that points into the main
    checkout's live `node_modules`, because...") and a scenario assertion ("no symlink
    into the main checkout, no `npm` install performed").
  - `ticket.md:26,29` — the *original* options list still names symlink as "Recommended
    default." This is the pre-decision ticket record, not a live planning artifact;
    `design.md`'s Planner Notes (line 102) explicitly document the supersession
    ("Design-gate round 1 corrected the link mechanism from symlink to hardlink copy
    after the skeptic reproduced the symlink's destructive `npm ci` failure mode").
    Round 2 already judged this non-blocking for the same reason; re-affirmed here —
    `ticket.md` is not the artifact any task/spec/design decision references or
    contradicts, and no implementer reading `design.md`/`tasks.md`/`spec.md` (the
    documents that actually drive implementation) would be misled toward the rejected
    mechanism.
  - **Conclusion: every remaining symlink mention appears ONLY in explicitly-rejected /
    historical-record framing.** No artifact instructs or implies implementing a
    symlink as the chosen mechanism. The two round-2 Change Requests (`design.md`
    Goals line 21, `proposal.md` "What Changes" lines 9-21 + Capabilities line 30-33)
    are confirmed fixed by direct re-read — both now describe hardlink-copy + guarded
    `npm ci` fallback, matching `design.md` Decision 2/3 and `spec.md` verbatim.
- Re-checked internal consistency end-to-end across all five artifacts for the
  mechanism description (not just symlink wording): `proposal.md` "What Changes" ↔
  `design.md` Decisions 1-5 ↔ `spec.md`'s three Requirements/six Scenarios ↔ `tasks.md`
  2.1-2.5/4.1-4.4 all describe the same algorithm (skip-if-exists → lockfile-match →
  `cp -al` → `EXDEV`/mismatch/missing → `npm ci` → guarded/non-aborting under
  `set -euo pipefail`) with no contradictions found.
- Re-verified ground truth in `~/Development/concertino` (source repo, unchanged since
  round 2 — this is still the design gate, no code has landed):
  - `core/scripts/setup-worktree.sh`: `set -euo pipefail` (line 2), env-file copy loop
    then hooks loop with `... || true` guard (lines 88-107) — confirms the design's
    cited placement ("after env-file copy, before the hooks loop") and guard-pattern
    citation are grounded in the real file.
  - `config/concertino.schema.json`: `worktree` object has `additionalProperties: false`
    and no `linkModules` property among `base`/`ports`/`envFiles`/`hooks` — the schema
    edit `tasks.md` 2.4 calls for is still genuinely required, not speculative.
  - `bin/concertino`: no `linkModules`/`CONCERTINO_LINK_MODULES` present yet — matches
    premise that this is unimplemented design work.
- Confirmed every ticket Acceptance line still traces to a covered task/spec scenario
  (unchanged from round 2's finding; no AC left uncovered by the round-3 edits).

### Verdict: CONFIRM

The mechanism (hardlink copy with guarded lockfile-diff/EXDEV `npm ci` fallback, never
aborting `set -euo pipefail` setup) is sound, empirically grounded (round 1's
reproduction), and consistently, testably specified across `design.md`, `spec.md`, and
`tasks.md`. The two round-2 contradictions (`design.md` Goals, `proposal.md` What
Changes/Capabilities) are confirmed fixed by direct re-read, and no new contradictions
were introduced. `ticket.md`'s stale "Recommended default" symlink mention is the
original pre-decision options record, explicitly superseded in `design.md`'s Planner
Notes, and does not drive implementation — non-blocking, consistent with round 2's
judgment.

### Non-blocking notes

- `ticket.md` line 26/29 still lists symlink as "Recommended default" among the original
  options. Not required to edit (it's a historical record, not a live planning
  artifact), but if the planner wants zero residual ambiguity for a future cold reader,
  a one-line addendum in `ticket.md` ("superseded — see design.md Decision 2") would
  close the loop entirely. Purely cosmetic.
- Carried forward from round 2 (still true, still non-blocking): the narrow generic-case
  gap where a worktree lockfile is missing but the main checkout's module dir exists
  (causes a doomed-but-guarded `npm ci` attempt in a directory with no lockfile) doesn't
  affect helio and isn't worth blocking on.
