# Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold agent. Every number below was measured by me on this worktree at `3a0c0fe8` (verified
`git log --oneline -1`, tree clean apart from the untracked change dir). No count is inherited.

## What I verified (with evidence)

### Premise, re-measured independently (not inherited)

Script over all 110 `frontend/src/**/*.css` files, using HEL-441's exact `stripComments` regex:

```
themeDefs 81   allDefs 83
refsPre 89     refsPost 88     pre−post diff = ['--app-top-chrome-']
naivePre 100   naivePost 99    pre-only extra = ['--error']
unresolved (8): --dashboard-background-override --dashboard-grid-background-override
                --mobile-panel-height --panel-surface-override --panel-text-override
                --radius-sm --space-sm --text-small
```

Every figure in ticket/design/tasks reproduces exactly: 81/83, 89 pre-strip / 88 post-strip,
100−17 pre / 99−16 post, 8 unresolved = 3 defects + 5 runtime-injected. Three rounds did **not**
inherit a common mistake.

### Attack 1 — the exact-set fixture is the only thing holding the fail-open hole shut

I re-enumerated the 16 post-strip spurious names and printed the *source line* for each. All 16
are BEM modifier + pseudo-class or pseudo-element, confirming round 3:

- pseudo-class: `.add-source-modal__type-btn--active:hover`, `.panel-detail-modal__btn--cancel:hover`,
  `.mfa-security-section__action-btn--danger:hover`, `.user-menu__item--getting-started:hover`,
  `.onboarding-checklist__action--ghost:hover:not(:disabled)`,
  `.pipeline-detail-header__source-chip-name--link:hover,`,
  `.connectors-page__btn--primary:hover:not(:disabled)`,
  `.panel-detail-modal__btn--save:hover:not(:disabled)`,
  `.onboarding-checklist__action--secondary:hover…`, `.user-menu__item--settings:hover`,
  `.user-menu__item--signout:hover`
- pseudo-element: `.panel-content--collection::-webkit-scrollbar`,
  `.pipeline-detail-page__run-status--queued::before`, `…--running::before`,
  `.panel-content--table::-webkit-scrollbar`, `.panel-content--text::-webkit-scrollbar`

The fixture in task 4.2a / design D3a carries `.a__b--decoy:hover {}` **and** `.x--other::before {}`
— both shapes are covered; the protection is not illusory.

I also checked the matcher from the other side (does the strict declaration-position rule
*under*-admit?). My strict matcher `(?:^|[{;])\s*(--x)\s*:` yields exactly 83 definitions and
exactly the 8 expected unresolved references — no real declaration is lost. I grepped for
`&`-nested CSS (which could put a modifier at true line start and defeat line-start anchoring):
**zero occurrences** repo-wide. No known BEM fragment survives the specified rule.

### Attack 2 — does the mandatory extractor export cross the "no unrelated refactor" line? No.

- `frontend/src/theme/motionTokenGuard.css.test.ts` has **zero** `export` lines (grepped) —
  the "port, don't import" premise is true, not assumed.
- Task 1.2's quoted regex is byte-identical to the shipped source at
  `motionTokenGuard.css.test.ts:40`: `text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))`.
- The export is from the **new** script; no shipped file is edited in service of a test. Design D2 and
  the workflow-state NOTE both say this. Confirmed.

### Attack 3 — round 3's CRs actually addressed, and precedent quoted not paraphrased

- CR3 (paraphrase trap): `scripts/check-dependabot-groups.mjs:421` reads
  `if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {` — tasks 4.3a now
  quotes this **exactly**, including the warning that the paraphrase is always false. Verified
  against source. The scan-root citation is likewise exact: `:392` is
  `const repoRoot = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");`
- CR2 (fallback): decided in design D3b **and** task 2.1a, mutually consistent, with the
  `--mobile-panel-height` (allowlisted, no fallback) argument intact.
- Other cited precedents check out: `check-node-root-encoding.mjs:49` is indeed
  `const KNOWN_ROOT_QUALIFIED_LINES = new Set([` (a membership list of exceptions, not a count);
  `check-no-credential-in-agent-surface.selftest.mjs` is `finally`-guarded **and** idempotently
  cleaned at startup (lines 56/62/87, sweeps at 128–222).
- Allowlist setters — all five traced to source myself, none copied:
  `MobilePanelStack.tsx:104`, `App.tsx:192`, `PanelList.tsx:272`, `PanelCard.tsx:29`, `:34`.
- The three defects exist at exactly the stated counts: `PipelineDetailPage.css:524,543`
  (`--radius-sm`), `:538` (`--text-small`), `AddSourceModal.css:111` (`--space-sm`). Intended tokens
  are unambiguously available from siblings/theme (`--app-radius-sm` used 20× in the same file;
  `--text-sm`; the `--space-1..10` scale), so task 3.2's "read the declaration" is a real,
  answerable instruction rather than a deferred decision.
- Wiring surfaces exist for task 5.1: `.husky/pre-commit:12–15` and `ci.yml:40–46` both run
  `check:*` + `:selftest` pairs.

### Attack 4 — joint interaction of all seven fixes (halt-rule check)

Checked pairwise and jointly: extractor export × exact-set assertion (the exact-set runs through the
pure extractor, the decoy-fails case through the guard's output — no collision); fallback-checked ×
allowlist (allowlist keys on token name, so the 4 fallback-bearing overrides still pass); nested
`var(--a, var(--b))` × reference regex (my measurement used exactly this shape and produced the
predicted 88/8); comment-stripping × fixture cases (disjoint); token-named-in-output × mkdtemp seam
(this is the round-2 fix and it holds). **No fourth fix-interaction defect found. The halt rule is
not triggered.**

### Attack 5 — could an executor build this without improvising?

Yes. Every decision that was open in round 3 is now closed in both artifacts. I looked specifically
for another `var(--token, fallback)`-class gap (matcher shape, source set, fallback, baseline
location, seam, sandbox, allowlist justification, defect token choice) and found none that forces an
unmade judgement call.

### design.md ↔ tasks.md agreement

Mapped D1↔§1/§4, D2↔1.2, D3↔1.3, D3a↔1.2a+1.3a+4.2a+4.2b, D3b↔2.1a, D4↔2.1/2.2, D5↔§3,
Gate-Chain↔5.2, seam↔4.3a, startup-cleanup↔4.3b. They agree on every decision. One **stale sentence**
survives in design.md (note 1 below) — it is residue of round 3's CR1, contradicted in caps by
tasks.md and by the workflow-state NOTE, so it cannot plausibly drive an executor to the wrong
build, but it should be corrected in the same pass.

## Verdict: CONFIRM

The premise reproduces exactly, all three rounds' CRs are substantively addressed (not merely
acknowledged), the exact-set fixture genuinely covers both spurious shapes on the real corpus, no
shipped file is refactored for a test, and no new interaction defect was introduced. Remaining items
are editorial and go below rather than costing a fifth round.

## Non-blocking notes

1. **design.md:202–206 still states the seam as a disjunction** — "The guard must therefore expose
   **either** an explicit scan-root argument **or** a pure extractor function". That is the exact
   false disjunction round 3 refuted; tasks 4.3a corrects it ("EXPORTING A PURE EXTRACTOR IS
   MANDATORY, not one of two options") but design.md was not updated to match. Replace the sentence
   with the tasks.md formulation so the two artifacts do not disagree on the point that was refuted.
2. **The 16/17 enumeration in design.md:98–99 and tasks 1.2a lists 17 names** (it includes
   `--error`) while labelling them "the 16". `--error` is the *pre*-strip extra — measured
   post-strip the set is the other 16, which I verified. Precondition slip of exactly the kind
   lesson "attach the precondition to every count" names.
3. **tasks.md 1.2a contains a dangling revision fragment** — "…16 spurious. (Reference counts
   likewise: …) The 16 spurious. Without stripping it is 100/17…". The second "The 16 spurious."
   is orphaned text from an insertion. Cosmetic only.
4. **Startup cleanup (4.3b) is near-vacuous under `mkdtemp` in `os.tmpdir()`** — there is no
   deterministic path to sweep. Implement it as a prefix sweep (`mkdtemp(join(tmpdir(),
   "helio-tokens-selftest-"))` + remove stale `helio-tokens-selftest-*` at startup) rather than
   dropping it or, worse, reintroducing in-repo planting, which 4.3b explicitly rejects.
5. **tasks 4.3a's "Add a scan-root argument too if useful" understates a hard requirement.** Task
   4.1 ("runs the guard") + 4.3 (`mkdtemp`) + 4.2b (assert on the guard's *output*) jointly make the
   scan-root argument unavoidable — the guard's CLI cannot otherwise be exercised end-to-end. Read
   "if useful" as "also required", so the selftest exercises `main()` and not only the pure
   extractor.
6. **design.md:141's D3b opening sentence is garbled** ("is undecided nowhere else in these
   artifacts, and it must be"). The decision below it is clear; the sentence is not.
