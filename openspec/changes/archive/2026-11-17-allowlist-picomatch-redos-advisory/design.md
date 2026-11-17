## Context

`security` (`.github/workflows/ci.yml` steps "Frontend audit (root)" / "Frontend audit (frontend/)") runs
`npx audit-ci --config .audit-ci.jsonc` (audit-ci 7.1.0) in each tree at the moderate threshold. Both fail on
GHSA-fc5q-39xc-vjpf only (picomatch `<= 4.0.7`; 4.0.7 is latest, no patch). `npm audit --omit=dev` is 0 in both trees.
Root `.audit-ci.jsonc` holds one entry, HEL-1246's `"GHSA-vfj7-8cjw-p6xm|*micromatch>braces*"` (review-by 2026-11-02);
`frontend/.audit-ci.jsonc` is empty. On 2e98eba92 audit-ci already prints `Consider not allowlisting path:
GHSA-vfj7-8cjw-p6xm|*micromatch>braces*` for root: the braces advisory is no longer reported against the lockfile.

How audit-ci matches (read from `node_modules/audit-ci/dist/chunk-FA3SOWIW.js` L705-753): for npm 7+ output it walks
`effects` up from picomatch with a DFS. A node with `effects: []` ends a full path (head = that top vulnerable node).
A parent already visited in the walk returns the caller's path unchanged, so that path is TRUNCATED: its head is the
node below the re-hit parent (DFS-order dependent) and it keeps a trailing `>` (e.g. root `jest-util>picomatch>`,
frontend/ `picomatch>`). An allowlist entry is `"<GHSA>|<template>"`;
`matchString` turns `*` into `.*` inside a FULLY ANCHORED regex (`^...$`). An advisory passes only if EVERY one of its
paths matches some entry. A leading `*` therefore matches the path's tail anywhere; no leading `*` anchors at the head.

## Goals / Non-Goals

**Goals:** green `security` with the narrowest scopes audit-ci's path model allows; a recorded negative check;
HEL-1246 entry re-checked. **Non-Goals:** dependency upgrades, overrides, pins, lockfile or CI-workflow edits.

## Decisions

**D1 - Enumerate, don't guess.** Take the exact `GHSA-fc5q-39xc-vjpf|...` lines audit-ci prints under "Found vulnerable
advisory paths" in each tree (root ~31 distinct, frontend/ its own set) and record them in `evidence/`.

**D2 - Verbatim, head-anchored entries.** Each entry is the reported path string VERBATIM, including any trailing
`>`, followed by `*`: `"GHSA-fc5q-39xc-vjpf|<reported path>*"`. Never strip the `>`. frontend/'s `picomatch>` path
becomes `"GHSA-fc5q-39xc-vjpf|picomatch>*"`; `"GHSA-fc5q-39xc-vjpf|picomatch*"` is FORBIDDEN (it matches a bare
direct-dep `picomatch` path - the package-wide shape). Grouping is allowed only as the complete head package name plus
`>` before any `*` (e.g. `jest>*`, never `jest*`, which matches `jest-newprod>picomatch`), and every grouped head must
pass D3. No leading `*` anywhere. Rejected: HEL-1246-style tail scopes (`*micromatch>picomatch*` etc.) - they also pass
a future `prod-lib>micromatch>picomatch`. Why head-anchoring is tight: a new prod path must end at a new or changed
top-level vulnerable node, whose first visit emits a full path with a new head no entry matches; truncated heads only
re-emit nodes whose first visit already produced a full path. Cost: lockfile churn can reshuffle DFS order and re-red
CI; fail-closed and acceptable for a 30-day allowlist (stated in the PR body).

**D3 - Every head is dev-only.** For each distinct head package, confirm in that tree's `package-lock.json` that every
`node_modules/**/<head>` entry has `"dev": true` (record the check). A head that is not dev-only is a BLOCKER, not an entry.

**D4 - Negative proof runs audit-ci's shipped code, with a positive control.** `Model` is not exported, and a
reimplemented matcher does not count. Run the installed audit-ci CLI with the committed config in a scratch dir under
`.concertino/scratch/HEL-1751/` whose PATH-first `npm` shim prints synthetic npm-7 `npm audit --json` (or a scratch
lockfile). The input holds (a) a control: at least one real allowlisted dev path, which must NOT be reported (proves
the committed JSONC was loaded), and (b) `prod-lib>micromatch>picomatch`, `prod-lib>tinyglobby>picomatch` and a bare
direct `picomatch`, each of which must appear under "Found vulnerable advisory paths" with a non-zero exit. Do this for
both configs. Also drop one real entry and show the real audit goes red, then restore. Record all output.

**D5 - HEL-1246 braces entry.** (D3 applies to every head in committed entries, truncated heads included.) Check the advisory (`gh api /advisories/GHSA-vfj7-8cjw-p6xm`: patched/withdrawn/range)
and whether root `npm audit --json` still reports it. If it is not reported (as audit-ci's "Consider not allowlisting"
says) the entry is removed, the `gh api` result (withdrawn_at / vulnerable range; braces 3.0.3 is still installed,
so "a patch exists" is NOT the reason) stated in the commit and PR (stale suppressions hide future paths). If it is still
reported, extend review-by to 2026-12-17 with the reason in its comment.

**D6 - Comments.** Each file gets one comment block above its entries: HEL-1751, dev-only (`--omit=dev` = 0),
no patched picomatch (4.0.7 latest), the dev-tool families covered (jest/jest-util, jest-haste-map>anymatch,
micromatch, typescript-eslint>tinyglobby, fdir), review-by 2026-12-17, remove once picomatch > 4.0.7 ships.

## Risks / Trade-offs

- audit-ci paths do not encode dev vs prod. If a currently dev-only HEAD package later became a prod dependency its
  identical path would stay allowlisted. Mitigated by D3, the review-by date, and recorded `--omit=dev` = 0.
- npm's `fixAvailable: jest@30.2.0` in frontend/ is not a picomatch patch (no picomatch > 4.0.7 exists); verify and
  note it - an actual patched picomatch would require escalation before any change.

## Planner Notes

- Self-approved: D2 (head-anchored over HEL-1246 tail style - same allowlist mechanism, tighter scope, per driver's
  "scopes must be tight"); D5 removal branch (the ticket's "patch exists, remove" intent covers an advisory that no
  longer applies; a stale entry is a silent suppression).
- Spec deltas: ADDED dev-path-scope requirement in both audit specs; MODIFIED frontend audit scenario to the root
  wording (high findings may be covered by path-scoped entries), since "zero moderate-or-higher" is no longer true.

## Implementation Deviation (D2 refined, HEL-1751 executor)

Probed during implementation: audit-ci's reported path strings are NOT stable across runs (npm audit key
order changes which re-visited parent truncates a path; five repeated runs and a before/after comparison
produced different head sets - see evidence/). A verbatim per-path list (D2 as first written) therefore
re-reds CI intermittently. D2's own grouping rule is used instead: one `<full package name>>*` entry per
package in picomatch's transitive `effects` closure (root 43, frontend/ 46 = the ticket's counts), each
verified `"dev": true` (D3, evidence/d3-*). A path must start at one of those dev packages; a production
path starts at a production package, so it still fails (evidence/negative-proof-shim.txt). No leading `*`,
no `picomatch*`/`jest*` forms. D5: braces entry REMOVED - GHSA-vfj7-8cjw-p6xm has withdrawn_at
2026-10-23 (evidence/ghsa-vfj7-advisory.json) and is no longer reported by `npm audit`.
