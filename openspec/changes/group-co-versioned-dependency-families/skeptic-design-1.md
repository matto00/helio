# Skeptic Report — design gate (round 1, skeptic-design-1.md)

## What I verified (with evidence)

### Manifests (Decision 1 enumeration — the criterion the user weighted highest)

`node -e` dump of `frontend/package.json`, root `package.json`, and inspection of
`backend/build.sbt` coverage claim.

- **`frontend/package.json` has 18 production dependencies, not 17** as design.md
  line 30 states.
- Design.md's Decision 1 table accounts for exactly 17 (fortawesome 4, echarts 2,
  redux 2, markdown 2, react core 2, plus `react-router-dom`, `axios`,
  `lucide-react`, `qrcode.react`, `tslib`). **`react-grid-layout` (`^2.2.2`) appears
  nowhere in the table, and nowhere in any artifact in the change directory**
  (`grep -rn "grid-layout" openspec/changes/group-co-versioned-dependency-families/`
  → no match).
- It is not a hypothetical omission: **PR #481 "Bump react-grid-layout from 2.2.3 to
  2.2.4 in /frontend" is open right now** (`gh pr list --author app/dependabot`).
  The enumeration that is supposed to be derived from the manifest missed a package
  that Dependabot has an open PR for.
- Its transitive `react-draggable` / `react-resizable` are not manifest entries, so
  the correct verdict is almost certainly *independent* — but the AC requires each
  entry "either grouped or explicitly justified as independent", and this one is
  neither. It is simply absent.

### Declared contracts checked against real package metadata

Read `peerDependencies`/`dependencies` from the installed packages in
`frontend/node_modules`:

| Claim in design.md | Ground truth | Assessment |
| --- | --- | --- |
| `echarts-for-react` peer-depends on `echarts` and re-exports its option types | peer: `echarts: "^3.0.0 \|\| ^4.0.0 \|\| ^5.0.0 \|\| ^6.0.0"` | Peer link real; grouping justified. But the stated "a major/**minor** skew changes the option type surface" is not supported — the declared peer range spans four majors. Overstated, not false. |
| `redux`: "RTK's typed hooks and `Provider` store typing bind to `react-redux`'s type surface; the two are released against each other" | `@reduxjs/toolkit@2.11.2` peer: `react-redux: "^7.2.1 \|\| ^8.1.3 \|\| ^9.0.0"` (three majors wide — the opposite of co-versioned). `react-redux@9.2.0` peer: `redux: "^5.0.0"` (hard, narrow) — and `redux` is a *bundled dependency of RTK*, not a manifest entry. RTK does not provide the typed hooks; `react-redux` does. | **The stated binding contract is wrong.** A real contract exists (react-redux's narrow `redux ^5` peer vs. the `redux` RTK vendors), but it is not the one written down. |
| `markdown`: `remark-gfm` "is loaded through `react-markdown`'s `remarkPlugins`; both bind to the same `unified`/`mdast` major" | `remark-gfm@4.0.1` declares **no `peerDependencies` at all**; `react-markdown@10.1.0` does not depend on `remark-gfm`. Both do list `unified`, `remark-parse`, `@types/mdast` as their own deps. | Contract is real but purely transitive and undeclared — materially weaker than fortawesome's live-CI-proven one. "A skew is a runtime plugin-interface failure" is an assertion, never observed. Group is low-risk, but the evidence grade should be labelled honestly rather than stated flat. |
| `backend/build.sbt` families all covered by `patterns: ["*"]` | `.github/dependabot.yml` sbt config confirmed `patterns: ["*"]`; PR #489 is a single "sbt group … with 54 updates" | Confirmed. |
| github-actions covered by `patterns: ["*"]` | Confirmed in config; PR #477 is one grouped PR of 3 | Confirmed. |

### Decision 4 (`open-pull-requests-limit`)

Counted open Dependabot PRs by config: frontend npm = #488, #487, #486, #485, #484,
#483, #482, #481, #479, #478 = **exactly 10 against a limit of 10**. Root npm #480,
actions #477, sbt #489 = 1 each. Design's saturation claim is **confirmed by
measurement**. Raising the frontend limit only is proportionate and in scope (the
ticket explicitly asks for a ruling on the limit).

### Decision 2 (first-match ordering)

`.github/dependabot.yml` confirmed: in the `/frontend` config `dev-dependencies` is
declared before `react`. Design.md line 57 states plainly that the backlog cannot
distinguish the defect from its absence (no `@types/react*` update this cycle) and
that the conclusion rests on documented semantics. **That honesty is adequate** —
the change is behaviour-neutral if the documentation is wrong, the alternative
(`exclude-patterns`) is correctly rejected as drift-prone, and the fix converts an
untestable assertion into a validator assertion. Not unjustified scope.

### Decision 3/6 (failability)

- Task 1.1 (validator written first, run red against the *unmodified* config, exit
  code and `fortawesome` named, transcript stored) + task 5.3 (same command green
  after) is a **genuine red/green failable pair**, not inspection.
- Task 2.6's five in-memory fixtures each asserting on the *reason* rather than only
  a non-zero exit is the right bar.
- Decision 3's rejection of a Jest test on HEL-880 grounds (vacuous jest gate in a
  worktree) is correct and shows the failability rule was actually applied.
- Decision 6 is honest that the in-PR validator proves our config matches our
  *intent*, not that Dependabot behaves as documented, and does not let the
  post-merge prong be quietly substituted.

**This part largely holds.** The two real holes are in §Change Requests 3 and 4.

### Gate-chain checklist

`.husky/pre-commit` and the `frontend` job in `.github/workflows/ci.yml` read; the
insertion points named in tasks 4.2/4.3 exist and the `check-openspec-hygiene.selftest.mjs`
convention cited in task 2.6 exists in `scripts/`. The no-`node_modules` /
no-git-invocation reasoning in the checklist is sound and correctly ties to the
HEL-657/HEL-805 mechanism.

### Decision 5 (HEL-874)

Sound, **not** a rationalisation. Reason 2 is the substantive one and is a real
methodological conflict: proving native auto-merge now waits on `ci-complete`
requires consuming the same Dependabot backlog this ticket must leave in a stated
condition, so neither result would be cleanly attributable. Reason 1 (formation vs.
merging; static vs. live verification) is a real seam. The commitment to post the
confirmed ruleset `14964282` evidence to HEL-874 (task 6.4) means the leave-alone
is not a dropped thread. This satisfies "leave it alone and say why", not
"half-do it". No revision required.

## Verdict: REFUTE

The validator design and the honesty about evidence grade are genuinely good. The
refutation is centred on the enumeration — the criterion the ticket and the user
both weight highest — which is demonstrably incomplete against the real manifest,
and on two claimed contracts that the package metadata does not support as written.

## Change Requests

1. **`react-grid-layout` is missing from the Decision 1 enumeration.**
   `frontend/package.json` has **18** production dependencies; design.md line 30
   says 17 and its table lists 17. Add `react-grid-layout` (`^2.2.2`) as a row with
   an explicit verdict and justification. Ground truth for the verdict:
   `react-grid-layout@2.2.3` declares peers `react >= 16.3.0`, `react-dom >= 16.3.0`
   only, and its `react-draggable` / `react-resizable` deps are transitive, not
   manifest entries — so *independent* is the defensible call, but it must be
   **stated**, not omitted. Correct the count `(17)` → `(18)`. Note that open PR
   #481 bumps exactly this package, so the omission is live, not academic.

2. **The `redux` family's stated binding contract is factually wrong; restate it.**
   design.md line 36 says RTK's typed hooks bind to `react-redux` and "the two are
   released against each other". Measured: `@reduxjs/toolkit@2.11.2` declares
   `peerDependencies.react-redux: "^7.2.1 || ^8.1.3 || ^9.0.0"` — three majors wide,
   i.e. explicitly *not* co-versioned — and the typed hooks are `react-redux`'s, not
   RTK's. The defensible contract is that `react-redux@9` hard-peers `redux ^5.0.0`
   while RTK vendors `redux` as a direct dependency, so a `react-redux` major that
   moves its `redux` peer requires RTK to move with it. Either restate the contract
   in those terms or drop the group. Do not leave the current justification standing
   — the spec delta's own qualifying test is "a version mismatch between its members
   can fail a gate that each would pass alone", and the written rationale does not
   establish that.

3. **Make an *unenumerated* family mechanically detectable — the accepted risk in
   §Risks has already materialised.** design.md line 120 accepts that "a newly added
   family nobody declares is not mechanically detectable", mitigated only by the
   recorded enumeration. Change Request 1 proves that mitigation failed on this very
   change. Extend the validator (Decision 3 / tasks 2.3, 2.5) with a **coverage
   assertion**: enumerate every entry in each configured directory's manifest
   `dependencies` block and fail unless each one is either a member of a declared
   family or listed on an explicit `declaredIndependent` allowlist embedded in the
   script (the independent rows of the Decision 1 table already supply that list).
   Add a sixth selftest fixture in task 2.6: *a manifest containing a production
   package that is on neither list → expect fail, asserting on the package name*.
   This is cheap, and it is the only part of the design that mechanically defends
   the acceptance criterion the ticket says matters most.

4. **AC #2 ("does the family pass at matching versions?") currently has no path that
   terminates inside this ticket.** Decision 6's post-merge prong depends on
   `@dependabot recreate` regrouping, and §Risks correctly flags it may only rebase;
   task 6.1's fallback is "close the four and wait for the next scheduled run" —
   a *weekly* schedule, so the ticket could be delivered with a stated AC
   unanswered for up to a week. Add a deterministic local probe to the plan: on a
   throwaway (uncommitted, never-pushed) working copy, install all four
   `@fortawesome/*` packages at their matching target versions (core 7.3.1,
   free-solid 7.3.1, free-brands 7.3.1, react-fontawesome 3.5.0) and run
   `npm run typecheck`, recording the transcript to the change's `evidence/`
   directory. That answers "does 7.3.1 break us?" immediately and independently of
   Dependabot's scheduling, while preserving the Non-Goal that **no manifest or
   lockfile change is committed** (task 3.4's `git diff --stat` assertion still
   holds). The real grouped PR then confirms rather than being the sole source of
   the answer.

5. **Constrain the group patterns explicitly so the reorder cannot backfire.**
   Decision 2 moves pattern groups ahead of the catch-all, which makes pattern
   *precision* newly load-bearing among the pattern groups themselves. State in
   tasks 3.1/3.2 that every family pattern is an **exact package name** with the sole
   exception of `@types/react*` — in particular the `react` group's pattern must
   remain `react`, never `react*`, which would otherwise swallow `react-dom`,
   `react-redux`, `react-markdown`, `react-router-dom` and `react-grid-layout` into
   the first-declared group. Correspondingly, task 2.4 should specify that the glob
   matcher anchors both ends and treats `*` as the only wildcard, so a sloppy
   implementation cannot make the check pass for the wrong reason.

## Non-blocking notes

- design.md line 35: `echarts-for-react`'s declared peer range is
  `^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0` — four majors. The grouping is still right
  (it re-exports echarts' option/instance types), but "a major/**minor** skew" is
  stronger than the metadata supports. Consider softening to the major case.
- design.md line 37: `remark-gfm` declares no `peerDependencies` at all, and
  `react-markdown` does not depend on it. The coupling is a shared *transitive*
  `unified`/`mdast` major. Worth labelling this family's evidence grade as inferred,
  to keep it visibly distinct from `fortawesome`, which has live CI proof.
- Decision 4's limit raise to 15 is measurement-backed (frontend npm is at exactly
  10/10) and correctly scoped to one config. Note that, as design.md itself says,
  grouping alone already unsaturates it — so the raise is belt-and-braces rather
  than load-bearing. Fine either way; no change requested.
- Root `package.json` carries `react-markdown` as a production dependency with no
  source tree to consume it. Out of scope here, but a plausible future spinoff.
