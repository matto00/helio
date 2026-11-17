## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 2e98eba9287d61a47957129f1f097ea039125d92 (no implementation commits yet; artifacts only).

### What I verified (with evidence)

- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/allowlist-picomatch-redos-advisory/hel-1751`.
- Read ticket.md, proposal.md, design.md, tasks.md, both spec deltas, and both current `.audit-ci.jsonc` files.
- **audit-ci matcher** (`node_modules/audit-ci/dist/chunk-FA3SOWIW.js`): `wildcardToRegex` is `^...$` anchored with
  `*` mapped to `.*` (L163-166). `matchString` does exact equality when there is no `*` (L167-169). An advisory passes
  only when every path matches (`falsy.length === 0`, L659). The design's description of the matcher is correct.
- **Path construction** (L705-753): the only walk start is a module whose `via` holds objects, which is picomatch
  itself. `recursiveMagic` prepends each `effects` parent. A parent that was **already visited** in this walk returns
  the caller's `dependencyPath` unchanged, so the emitted path **omits** that parent and keeps a trailing `>`. Only a
  node with `effects: []` gets the trailing `>` sliced off. So a trailing-`>` path's head is **not** the topmost
  ancestor. It is the node just below a node the DFS had already visited, and which node that is depends on DFS
  order. Scratch output confirms this: root has `jest-util>picomatch>`, `micromatch>picomatch>` and
  `@jest/core>jest-util>picomatch>`. frontend/ has **`picomatch>`** (head = picomatch itself; picomatch is not in
  `frontend/package.json` and is `"dev": true` in the lockfile), `tinyglobby>picomatch>` and `jest-message-util>picomatch>`.
- **Is head-anchoring still tight, given that?** Yes, by a different argument than the one design.md makes. Every
  vulnerable top-level node (`effects: []`) is the head of the full path emitted on its first visit. A new prod path
  has to end at a new or changed top-level node, so it adds a new head, which no head-literal entry matches, and the
  advisory goes red. A truncated head only re-emits a node whose own first visit produced a full path. The residual
  gap is one the design already names under Risks: an existing dev head moved to `dependencies` gives identical
  paths. D2's conclusion holds, but its stated reasoning ("starts at the TOPMOST vulnerable ancestor") is wrong.
- **Wildcard probe** (mirror of `wildcardToRegex`, run with node in my scratchpad):
  `picomatch>*` vs `picomatch` = false; **`picomatch*` vs `picomatch` = true**; `picomatch>*` vs `picomatch>` = true;
  `jest-util>picomatch*` vs `jest-util>picomatch>` = true; **`jest*` vs `jest-newprod>picomatch` = true**.
- **D4 feasibility:** the chunk's `export {}` (L1352-1362) exports `audit`, `allowlist_default`, `runAuditCi` and
  others, but **not `Model`**. D4's primary route ("feed ... to audit-ci's `Model`") cannot be imported as written.
  Its fallback ("or equivalent invocation of its exported matching") leaves room for a reimplemented matcher, which
  would prove nothing about the shipped code.
- **D5 / braces:** `GHSA-vfj7` gets 0 hits in both scratch `npm audit --json` outputs. Root lockfile still has
  braces 3.0.3 and micromatch 4.0.8, both `dev: true`. So the advisory is no longer reported while the same versions
  are installed, which points to a withdrawn or re-ranged advisory, not a patch. D5's plan is to check the advisory
  via `gh api`, then remove the entry if it is not reported or extend it if it is. That is consistent with the AC's
  intent ("re-checked ... reason stated"). The AC lists only "patch exists → remove" and "extend". Removing a dead
  suppression with the reason stated falls under that intent, and keeping it would hide future braces paths.
  Acceptable as long as the reason (advisory state from `gh api`) is recorded in the comment-free removal's commit/PR.
- Scope: config plus spec deltas only. Every AC maps to a task: AC1/2 → 2.1/2.3 + D6; AC3 → 3.1/3.2/3.3; AC4 → 1.2;
  AC5 → 1.5/2.2; AC6 → the PR CI. No placeholders. Spec deltas exist for both audit capabilities.

### Verdict: REFUTE

These are small but load-bearing clarifications. The fix belongs in design.md (and tasks.md 3.2), not in the plan's shape.

### Change Requests

1. **design.md D2 / Context: correct the path model, and pin the exact entry shape.** Replace "a path string starts
   at the TOPMOST vulnerable ancestor" with the actual behavior: trailing-`>` paths are truncated where the DFS
   re-hit a visited parent, so their head is DFS-order dependent. Then state the rule explicitly: **each entry is the
   reported path string verbatim, including any trailing `>`, followed by `*`**. Never strip the `>`. Name the
   frontend/ `picomatch>` path and say its entry is `"GHSA-fc5q-39xc-vjpf|picomatch>*"`. Forbid
   `"GHSA-fc5q-39xc-vjpf|picomatch*"` explicitly. Probe: `picomatch*` matches a bare direct-dep `picomatch` path,
   which is the ticket's forbidden package-wide shape and would turn D4's own third negative case green.
2. **design.md D2: define "head literal" for grouped entries.** A grouped entry must be the complete head package
   name followed by `>` before any `*` (e.g. `jest>*`, never `jest*`). Probe: `jest*` matches
   `jest-newprod>picomatch`. Either forbid grouping or state this rule, and require every grouped head to pass the
   D3 dev-only check.
3. **design.md D4 + tasks.md 3.2: make the negative proof run audit-ci's shipped code and carry a positive control.**
   `Model` is not exported (chunk L1352-1362), so name a route that runs the real code. Examples: run the installed
   audit-ci CLI with the committed config in a scratch dir whose PATH-first `npm` shim prints synthetic
   `npm audit --json`, or use a scratch lockfile. A reimplemented matcher does not count. The synthetic input must
   include (a) at least one real, allowlisted dev path. That is the control: it must **not** be reported, which
   proves the committed JSONC allowlist was actually loaded. (b) The three non-allowlisted cases
   (`prod-lib>micromatch>picomatch`, `prod-lib>tinyglobby>picomatch`, bare direct `picomatch`) must each appear under
   "Found vulnerable advisory paths", with a non-zero exit. Without the control, "everything reported" is
   indistinguishable from "allowlist never parsed".

### Non-blocking notes

- D5: when the braces entry is removed, record the `gh api /advisories/GHSA-vfj7-8cjw-p6xm` result (withdrawn_at /
  vulnerable range) as the stated reason. Braces 3.0.3 is still installed, so "a patch exists" is not the reason.
- D3: run the dev-only check on every head that appears in the committed entries, including truncated heads
  (`jest-util`, `micromatch`, `tinyglobby`, `picomatch`, `@jest/core`, ...), not only top-level ones.
- Expect fail-closed churn. Truncated heads depend on DFS order, so any lockfile change can reshuffle paths and
  re-red CI within the 30-day window. The design already accepts this; say so in the PR body.
