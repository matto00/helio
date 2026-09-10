## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

**Round-4 CR1 fix — VERIFIED GOOD.**
- Read `specs/error-state-pattern/spec.md`. It is now a `## REMOVED Requirements` block whose
  heading ("EmptyState icon and cta icons accept a ReactNode") matches the live requirement in
  `openspec/specs/error-state-pattern/spec.md` verbatim, plus a `## ADDED Requirements` block
  naming a distinct successor ("...accept a ReactNode only") carrying only the surviving
  ReactNode scenario. The landmine scenario ("A FontAwesome IconDefinition still renders…") is
  gone from the delta entirely, not restated-and-contradicted.
- Reason/Migration text is adequate and self-contained: Reason names the cause (`@fortawesome/*`
  removed by HEL-443), Migration names the successor requirement by its exact title.
- The successor name reads fine — "accept a ReactNode only" is slightly clipped English but its
  meaning is unambiguous and it will not mislead a future reader. Not blocking, not worth a round.
- Nothing else in the live `error-state-pattern` spec depends on the removed requirement: I read
  the whole file. The other five requirements reference `cta`/`secondaryCta`/`intent`, never the
  `IconDefinition` arm or `FontAwesomeIcon`.
- `npx openspec validate single-icon-system --type change --strict` → `Change 'single-icon-system'
  is valid` (I ran it myself).
- Round-4 non-blocking notes both addressed: tasks.md:141-147 (11.1) now carries a concrete
  candidate list; tasks.md:98-100 (9.1) now points at 3.4b rather than restating it.

**New blocking finding — the dependabot co-versioning gate.**
- `grep -rln "FontAwesome\|IconDefinition\|fortawesome" openspec/specs/` returns TWO live specs:
  `error-state-pattern` (covered) and `dependabot-update-grouping` (uncovered by any delta).
- `grep -rni dependabot openspec/changes/single-icon-system/` → zero hits. No task, no delta.
- `.github/dependabot.yml:39-44` declares a `fortawesome:` group over the four packages this
  change deletes. `scripts/check-dependabot-groups.mjs:41-51` hardcodes the same family in
  `DECLARED_FAMILIES`, and it is wired into `.husky/pre-commit:14` and `.github/workflows/ci.yml:45`.
- Reproduced the breakage deterministically (twice, identical output) against a temp repo root
  whose `frontend/package.json` has the `@fortawesome/*` deps removed and `lucide-react` present:

  ```
  $ node scripts/check-dependabot-groups.mjs $TMP
  check-dependabot-groups: FAILED
    - family "fortawesome": declared member "@fortawesome/fontawesome-svg-core" is not in /frontend/package.json — stale declaration
    ... (x4)
  EXIT=1
  ```
  This is the checker's own `caseD_staleDeclaration` behavior
  (`check-dependabot-groups.selftest.mjs:150-168`), i.e. intended, not incidental.
- `lucide-react` is already on `DECLARED_INDEPENDENT` (`check-dependabot-groups.mjs:89`), so the
  incoming side needs nothing. The gap is purely the outgoing fortawesome declaration.

### Verdict: REFUTE

One blocking item. It is not re-scrutiny of ground already covered — it is the exact same defect
class as rounds 3/4's CR1 (a live spec + enforced config left asserting a package family the change
deletes), found in the second of the two files the grep returns. As planned today, task 1.x's
`npm uninstall @fortawesome/*` makes the very next `git commit` fail its pre-commit hook and CI
fail at `ci.yml:45`, with no task telling the executor why or what to do.

### Change Requests

1. **Retire the `fortawesome` co-versioned family alongside the package removal.** Add a task
   (adjacent to the `npm uninstall` step, in the same commit — the gate is per-commit) covering all
   four of:
   a. delete the `fortawesome:` group from `.github/dependabot.yml:39-44`;
   b. delete the `fortawesome` entry from `DECLARED_FAMILIES` in
      `scripts/check-dependabot-groups.mjs:42-52`;
   c. decide and state whether `check-dependabot-groups.selftest.mjs` needs touching — its
      `FORTAWESOME_GROUP`/`FAMILIES` fixtures are self-contained literals, so it most likely does
      NOT, but the task must say so explicitly so the executor does not "helpfully" rewrite the
      selftest fixtures and weaken caseA–caseE;
   d. add a spec delta for `dependabot-update-grouping` removing the now-false
      `#### Scenario: FontAwesome family upgrades together`
      (`openspec/specs/dependabot-update-grouping/spec.md:14-17`). Because that scenario sits under
      a requirement with other surviving scenarios, this is a `MODIFIED` requirement block that
      restates the requirement minus that scenario — the round-4 landmine rule still applies: the
      restated body must not mention FontAwesome at all. Pick a surviving family (e.g. echarts or
      redux) for the replacement scenario if one is needed to keep the requirement exemplified.
   Acceptance signal: `npm run check:dependabot && npm run check:dependabot:selftest` exit 0 on the
   post-uninstall tree, and `openspec validate single-icon-system --type change --strict` passes.

### Non-blocking notes
- "accept a ReactNode only" is a mildly awkward requirement title; harmless, do not spend a round on it.
- `scripts/check-dependabot-groups.mjs`'s header comment points at "openspec .../design.md Decision 1"
  (HEL-898's archived change). Worth a one-line update when 1b lands, but not required.
