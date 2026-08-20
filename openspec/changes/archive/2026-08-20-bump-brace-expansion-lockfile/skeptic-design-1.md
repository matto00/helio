## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and the spec delta
  `specs/dependency-security/spec.md` in full from the change directory.
- Confirmed the ticket's premise against live ground truth: ran `npm audit --json`
  at the worktree root. It reports exactly the two advisories the ticket cites
  (GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895) against `brace-expansion`, at the
  three dependency paths tasks.md §1.1 predicts verbatim:
  `node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion`,
  `node_modules/glob/node_modules/brace-expansion`,
  `node_modules/minimatch/node_modules/brace-expansion`. Confirmed via
  `package-lock.json` grep that the three installed instances are `5.0.7` (one
  site) and `2.1.2` (two sites) — both inside the advisories' vulnerable ranges.
  The ticket is not fabricated or stale.
- Confirmed the precedented `overrides` pattern (`package.json:22-29`) that
  design.md §Decisions cites (`@eslint/eslintrc` → nested `js-yaml` override) is
  real and matches the scoped-override fallback the plan proposes for
  `brace-expansion` if `npm update` alone can't reach the patched version.
- Compared this change's artifacts against its own stated precedent, the
  archived `2026-08-16-resolve-dependabot-security-alerts` (HEL-688) change
  (`openspec/changes/archive/2026-08-16-resolve-dependabot-security-alerts/`),
  which this ticket, proposal, and design.md all explicitly invoke as "the same
  pattern."
- Ran `gh api "repos/matto00/helio/dependabot/alerts?state=open"` — returns
  `[]`. No Dependabot alerts are currently open for this GHSA pair (or anything
  else), confirming the ticket's own framing ("Dependabot had not yet raised
  alerts for it at scoping time") and that AC3 below is a live contingency, not
  a hypothetical already ruled out.
- Checked for placeholders/TBD/hand-waving in all four artifacts — none found.
  Scope in proposal.md and design.md's Goals/Non-Goals match the ticket's Scope
  and Non-goals sections; no scope drift.

### Verdict: REFUTE

### Change Requests

1. **AC3 ("If Dependabot alerts exist for this pair by then, they are verified
   closed post-merge via the alerts API" — `ticket.md:36-37`) has zero coverage
   in `design.md` or `tasks.md`.** Neither document mentions checking
   `gh api repos/matto00/helio/dependabot/alerts` at all — not during
   investigation (tasks.md §1 only runs `npm audit`/`npm ls`), not as a decision
   in design.md, and not as a deferred/orchestrator-owned post-merge task. This
   is a real gap, not a stylistic one: the change's own stated precedent,
   HEL-688 (`openspec/changes/archive/2026-08-16-resolve-dependabot-security-alerts/`),
   faced the identical structural problem — a post-merge alert-closure AC that
   the orchestrator's generic Phase 3/4 flow won't otherwise touch — and solved
   it deliberately: `design.md` Decisions 5-6 there state *"the orchestrator's
   generic Phase 3/4 procedures never consult tasks.md"* and therefore
   operationalize the check as an explicit orchestrator-owned tasks.md section
   (§7, `7.1`-`7.3`) carried forward via the PR body and the Linear closing
   comment, with a reviewer note explaining why those boxes are expected to stay
   unchecked through Evaluation/Skeptic. HEL-707's `design.md` and `tasks.md`
   have no equivalent — if a Dependabot alert for this GHSA pair appears between
   now and merge (plausible, since that's exactly how this ticket itself came
   to exist), AC3 will be silently dropped with no carrier ensuring anyone
   checks it. **Required revision:** add a `design.md` Decision and a
   corresponding `tasks.md` section (mirroring HEL-688's §7 pattern) that (a)
   checks `gh api repos/matto00/helio/dependabot/alerts?state=open` for this
   GHSA pair before delivery, and (b) if any alert is found, adds an
   orchestrator-owned post-merge verification task with a concrete carrier (PR
   body / Linear closing comment) so it isn't lost at the tasks.md → delivery
   handoff.

### Non-blocking notes

- `design.md:35-41` (Decisions) and `design.md:68-70` (Planner Notes) both
  assert "no `specs/` delta file is created" — but
  `specs/dependency-security/spec.md` was in fact created in this same change
  directory, with its own header note explaining it exists "to make the version
  floor testable for evaluation" (matching HEL-688's identical delta pattern,
  confirmed by diffing against
  `openspec/changes/archive/2026-08-16-resolve-dependabot-security-alerts/specs/dependency-security/spec.md`).
  The spec delta itself is correct and precedented; only `design.md`'s prose is
  stale/wrong and should be corrected to describe the delta's actual purpose
  (as the spec file's own note already does) rather than denying it exists.
  Not blocking since the actual artifact is sound and `--skip-specs` archival
  works identically either way (confirmed HEL-688 shipped this same pattern).
- The "first patched version" language in `design.md`/`tasks.md` doesn't spell
  out that the two vulnerable major lines currently in the tree (`2.1.2` and
  `5.0.7`) have different actual floors (`>=2.1.4` and `>=5.0.9` respectively,
  per the audit's per-advisory ranges). This is resolvable at execution time via
  ordinary `npm update`/`overrides` judgment and doesn't block the design, but
  the executor should verify both floors explicitly rather than assuming a
  single version number satisfies every site.
