# Tasks — HEL-1037 var(--*) token-resolution guard

This ticket's DELIVERABLE is the distinction between a guard that proves something and one that
looks like protection. Build accordingly: the guard's own failability is the product, not a nicety.

## 1. The guard

- [x] 1.1 Add a `check:tokens` script beside the existing `check:*` scripts. It reads
      `frontend/src/**/*.css`, extracts `var(--*)` references and `--x:` definitions, and exits
      non-zero listing each unresolved reference with FILE AND LINE.
- [x] 1.2 STRIP CSS COMMENTS before extraction, preserving newlines so reported line numbers stay
      correct. PORT HEL-441's approach — `stripComments` in
      `frontend/src/theme/motionTokenGuard.css.test.ts`
      (`text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))`).
      PORT, do not import: that file has ZERO exports — `stripComments` is file-local in a TS Jest
      test, so a standalone check script cannot import it. Copy it WITH A PROVENANCE COMMENT naming
      the source file. Do NOT extract a shared module: that would edit HEL-441's shipped guard for
      no behavioural gain, and scope discipline here is explicit.
- [x] 1.2a A DEFINITION IS A DECLARATION, not any `--x:` in the file. This is the FAIL-OPEN hole and
      it is the worst defect available to this ticket. The naive matcher `(--[a-z0-9-]+)\s*:`
      yields 99 "definitions" against the real 83 ONCE COMMENTS ARE STRIPPED (task 1.2) — 16 
      spurious. (Reference counts likewise: 89 unique `var(--*)` PRE-strip, 88 POST-strip, the
      difference being `--app-top-chrome-`. Quote the precondition with any count.)
      Without stripping it is 100/17, the extra being `--error`, prose in a comment at
      `features/assistant/ui/ToolCallIndicator.css:81`. QUOTE THE PRECONDITION with either number.
      The 16 are BEM MODIFIER SELECTORS
      (`.foo__btn--primary:hover`, `.x--danger:hover`, `.y--queued::before`), admitting:
      `--active --cancel --collection --danger --error --getting-started --ghost --link --primary
      --queued --running --save --secondary --settings --signout --table --text`.
      `--text` proves the danger: `--text-small` is one of the three defects fixed here, so a future
      `var(--text)` typo would resolve against a SELECTOR FRAGMENT and pass — the guard failing open
      on exactly the class it exists to catch.
      Match a `--x:` only where a property may appear (line start / after `{` or `;`). A
      pseudo-class or pseudo-element colon in a selector is NOT a declaration colon.
- [x] 1.3 The token source set is EVERY `--x:` definition in the scanned CSS, NOT just `theme.css`.
      `--toast-exit-duration` and `--toast-intent-color` are legitimately defined in
      `shared/ui/toast.css`; scoping to `theme.css` reports both as undefined. This is the same
      first-run-red failure mode as 1.2, from a different cause.
- [x] 1.3a Do NOT put a live "definitions == 83" assertion in the guard. It was the obvious move and
      it is REJECTED: wired into `.husky/pre-commit` (task 5.1) it makes the NEXT UNRELATED TICKET
      that adds a legitimate token red at commit time, and concurrent lanes are moving frontend
      files right now (see 7.1). A contributor who bumps 83→84 to get their commit through has
      silently disabled the check — the inverse of protection. The over-permissiveness detector
      lives in the SELFTEST instead, over a controlled fixture (task 4.2a). Repo precedent for a
      baseline-in-guard is a membership list of accepted EXCEPTIONS
      (`check-node-root-encoding.mjs:49`), not a count every addition invalidates.
- [x] 1.4 Do NOT use `git` commands whose behaviour differs in a linked worktree, and do NOT assume
      `.git` is a directory — in a linked worktree it is a FILE. **Every delivery run in this repo
      happens inside a linked worktree**, so a guard that assumes a directory fails for every agent
      and passes for every human.

## 2. Allowlist

- [x] 2.1 Allowlist the five runtime-injected tokens, each entry NAMING ITS SETTER:
      `--dashboard-background-override` → `app/App.tsx`;
      `--dashboard-grid-background-override` → `features/panels/ui/PanelList.tsx`;
      `--panel-surface-override` → `features/panels/ui/PanelCard.tsx`;
      `--panel-text-override` → `features/panels/ui/PanelCard.tsx`;
      `--mobile-panel-height` → `features/panels/ui/grid/MobilePanelStack.tsx:104` (inline
      `CSSProperties`).
- [x] 2.1a A FALLBACK DOES NOT EXEMPT A REFERENCE (design D3b). `var(--token, fallback)` is still
      checked. 4 of the 5 allowlisted tokens are referenced in that form, so this is not academic.
      Exempting would let `var(--typo, 4px)` pass forever — a literal silently substituting for a
      design-system token, the violation HEL-346 exists to eliminate; it merely fails quietly rather
      than open. The legitimate JS-assigned case is what the ALLOWLIST is for, and
      `--mobile-panel-height` proves exempting would not even remove the need for one: it needs an
      allowlist entry and carries no fallback.
- [x] 2.2 An entry names a SETTER, not a sighting. `--mobile-panel-height` is the case that proves
      the rule: its only non-CSS hits are test files, so it looked test-only until the real setter
      was traced. "It appears in a test" is NOT a justification. Verify each setter yourself rather
      than copying this list — if one is wrong, the entry is unjustified.

## 3. Fix the three known defects — and only those three

- [x] 3.1 `var(--radius-sm)` ×2 and `var(--text-small)` ×1 in
      `features/pipelines/ui/PipelineDetailPage.css`; `var(--space-sm)` ×1 in
      `features/sources/ui/AddSourceModal.css`.
- [x] 3.2 Choose each replacement by READING THE DECLARATION and picking the intended token, not by
      nearest name. State in your report which token you chose for each and why.
- [x] 3.3 Do NOT absorb HEL-830's 119 off-scale spacing literals, HEL-680 or HEL-732. This is a
      guard, not a token cleanup.

## 4. Self-test — the actual deliverable

- [x] 4.1 Add `check:tokens:selftest` following the existing convention (`check:dependabot:selftest`,
      `check:openspec:selftest`, `check:node-root-encoding:selftest`,
      `check:no-credential-leak:selftest`). It plants a reference that cannot resolve, runs the
      guard, and reports success ONLY if the guard fails.
- [x] 4.2 Cover in the self-test: an undefined reference FAILS; a `var()` inside a comment does NOT
      trip it, exercised against the real `shared/chrome/MobileNavSheet.css:54-55` shape (a comment
      wrapping mid-token across a line break); an allowlisted token passes; a non-allowlisted
      undefined token fails.
- [x] 4.2a EXACT-SET CASE over a controlled fixture (this is the over-permissiveness detector, moved
      here from the guard per 1.3a): a fixture containing `--real: 1px;` plus `.a__b--decoy:hover {}`
      plus `.x--other::before {}`, asserting the extracted definition set EQUALS EXACTLY
      `["--real"]`. That is cardinality AND membership, fails precisely on the 1.2a defect, and is
      unaffected by token growth on `main`.
      Also assert a `var(--decoy)` reference STILL FAILS — `--decoy` was not accepted as a
      definition. Asserting only that the run stays green is INSUFFICIENT: a decoy silently ignored
      for an unrelated reason would pass a green-only assertion while proving nothing.
- [x] 4.2b EVERY selftest case MUST assert on the TOKEN NAMED IN THE GUARD'S OUTPUT, never on the
      exit code alone. Without this the seam (4.3a) and any corpus-shaped assertion collide FATALLY:
      pointed at a `mkdtemp` fixture, every "must fail" case would pass on an exit code the
      fixture's own contents produced — the decoy proving nothing, which is the green-only failure
      4.2a exists to prevent, re-entering by the back door — and every "must pass" case could never
      go green. So: decoy case asserts the output names `--decoy`; undefined-reference case asserts
      it names `--nope`; comment and allowlist cases assert it names NOTHING.
- [x] 4.3 SANDBOX HAZARD — the self-test MUST use `mkdtemp` and MUST NEVER mutate a tracked file. A
      crashed self-test that leaves a planted `var(--nope)` in a tracked file would BLOCK EVERY
      SUBSEQUENT COMMIT IN THE REPO. A guard whose self-check can brick the commit path is worse
      than no guard.
- [x] 4.3a THIS REQUIRES A SEAM — task 1.1's scan root is `frontend/src/**/*.css`, so a `mkdtemp`
      fixture is NEVER SCANNED and 4.3 is unimplementable as written without one. EXACT PRECEDENT
      exists and gives both halves at once: `scripts/check-dependabot-groups.mjs:392` takes
      `process.argv[2] ?? repoRoot` as its scan root, exports pure functions, and guards its main
      entry at `:421`.
      EXPORTING A PURE EXTRACTOR IS MANDATORY, not one of two options: task 4.2a's exact-set
      assertion needs the extracted DEFINITION set, and the guard's stdout lists unresolved
      REFERENCES only — so a scan-root argument ALONE cannot implement it. Add a scan-root argument
      too — that is ALSO REQUIRED, not optional: tasks 4.1 + 4.3 + 4.2b jointly need the guard's CLI
      run over a `mkdtemp` fixture with assertions on its OUTPUT, and the extractor alone cannot
      exercise `main()` end to end. Both, not either.
      COPY THE MAIN GUARD EXACTLY: it is
      `process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]`. A paraphrase of
      `import.meta.url === process.argv[1]` is ALWAYS FALSE (one is a URL, the other a path), so
      `main()` would never run and the guard would silently do nothing — a check that passes because
      it never executed.
- [x] 4.3b ALSO add idempotent STARTUP CLEANUP, not only `finally`. Under `mkdtemp` in
      `os.tmpdir()` there is no deterministic path to sweep, so implement it as a PREFIX SWEEP:
      `mkdtemp(join(tmpdir(), "helio-tokens-selftest-"))`, and at startup remove stale
      `helio-tokens-selftest-*` directories. Do NOT drop the requirement as vacuous, and do NOT
      reintroduce in-repo planting to make it concrete — that is what this task rejects. Precedent checked:
      `check:no-credential-leak:selftest` plants in-repo but is gitignored, `finally`-guarded AND
      cleaned at startup. Take the startup-cleanup half; REJECT the in-repo-planting half —
      `finally` does not survive `SIGKILL`, and startup cleanup is the only thing that recovers from
      a killed run.
- [x] 4.4 Cleanup MUST survive the self-test FAILING PARTWAY, not only succeeding. A cleanup that
      runs only on the success path is the hazard restated. TEST THE FAILURE PATH: force the
      self-test to fail mid-run and assert the working tree is left clean.

## 5. Wiring

- [x] 5.1 Wire `check:tokens` and `check:tokens:selftest` into `.husky/pre-commit` and CI beside the
      existing `check:*` scripts. CI matters independently: a local-only guard is blind to whatever
      a contributor skips with `-n`.
- [x] 5.2 This modifies the COMMIT-GATE CHAIN, so design.md's `## Gate-Chain Implications Checklist`
      applies and the Delivery gate checks for it mechanically. Re-read it before wiring; if the
      implementation diverges from any answer there, update the checklist in the same pass.

## 6. Evidence

- [x] 6.1 EMPIRICAL FIRST-RUN CHECK: run the FINISHED guard against UNTOUCHED `main` (before the 3.1
      fixes) and record the output; then against the fixed tree and confirm ZERO findings. There are
      THREE independent causes of a red-on-`main`-at-install — the comment false positive (1.2), the
      two `toast.css` definitions (1.3), and the three real defects (3.1). Passing after 3.1 alone
      does not prove 1.2 and 1.3 are right; the untouched-`main` run is what distinguishes them.
- [x] 6.2 DEMONSTRATE FAILABILITY BY MUTATION at review time as well as via the self-test: add a
      bogus `var(--nope)` to a real stylesheet, watch the guard go red, remove it. Report the exact
      output. The self-test is what keeps this true afterwards; the mutation is what proves it now.
- [x] 6.3 Gates: `npm run lint`, `npm run typecheck`, `npm run format:check`,
      `npm --prefix frontend test`. Do NOT cite root `npm test` as evidence for this change — it is
      `jest --passWithNoTests && npm --prefix frontend test`, and its root jest arm finds zero tests
      in a worktree and reports silence as a pass. State which gate exercised the new code.
- [x] 6.4 Run `check:tokens` and `check:tokens:selftest` from THIS LINKED WORKTREE and confirm both
      behave correctly here (task 1.4).

## 7. Handoff

- [x] 7.1 Rebase on `main` before the PR (concurrent lanes are moving frontend files) and re-run 6.1.
- [x] 7.2 Update `files-modified.md`, run gates, and COMMIT before yielding. Staging without
      committing is an incomplete handoff.
- [x] 7.3 PR body states: the three defects fixed and which token each became; that an undefined
      custom property FAILS OPEN, which is why no existing gate could see this class; the three
      distinct first-run false-positive causes and how each is handled; and that the allowlist names
      setters rather than reasons.
