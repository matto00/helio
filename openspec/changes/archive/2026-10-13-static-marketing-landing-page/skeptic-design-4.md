## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD `2c1ab0326fe6c171152bc59ff2918f433558296f`. The change dir is untracked (planning only).
I read ticket.md, workflow-state.md (CONSTRAINTS), proposal.md, design.md, tasks.md, the changed spec deltas,
marketing-landing-page/spec.md and skeptic-design-3.md.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/static-marketing-landing-page/HEL-1562`.
- **`openspec validate static-marketing-landing-page --strict` (openspec 1.10.0):** `Change 'static-marketing-landing-page' is valid`, EXIT=0.
- **Round 3, CR1 (`first-run-onboarding` delta): closed.**
  - `specs/first-run-onboarding/spec.md` exists and is named in D12.
  - I extracted the requirement block from the delta and from the living spec and diffed them. The only change is
    `opens \`/\`` → `opens \`/home\``. Both scenarios are kept.
- **Round 3, CR2 (mfa block): closed.** The mfa delta now has a "Verification step after OAuth callback" block.
  Diffed against the base, the only change is `(not \`/\`)` → `(not \`/home\`)`, so it now matches the password-path block.
- **Round 3, CR2 (scenario titles): the planner's claim holds.** I checked it in a scratch copy of `openspec/`:
  - Renaming the two titles makes `--strict` fail with: `MODIFIED "..." omits scenario(s) the current spec still
    has: "Breadcrumb shows Dashboards on /"` and the same error for "Navigating to / shows dashboard view".
  - I also tried a different mechanism: REMOVED plus ADDED of the same requirement. openspec rejects it too:
    `Requirement present in both ADDED and REMOVED`.
  - So the delta mechanism cannot retitle a scenario. The limitation is real and comes from the tool.
  - The effect is cosmetic. Each title is a label, and its body (the normative WHEN/THEN) says `/home`. D12
    allowlists both titles and gives the reason.
  - I judge this acceptable. A better fix is optional; see the non-blocking notes.
- **Round 3, CR3 (literal probe): closed.** D12 now has a literal command made of two patterns (P1 and P2). P2 adds
  `opens?`, which is the form that let first-run-onboarding slip through. Task 2.11 points at it.
- **I ran the probe after an archive dry-run.** In a scratch copy, `openspec archive static-marketing-landing-page -y`
  succeeded (`Totals: + 9, ~ 19, - 0`). Then I ran D12's exact P1|P2 grep over `openspec/specs`. Every hit falls
  into one of these groups:
  - Operators and separators: compute-expression-language, timestamp-value-parsing, trace-context-logging,
    pipeline-string-ops-op, pipeline-zero-root-db-guard (`42704`/`22P02`), and form-panel-rendering /
    form-panel-submit (`+`/`-`).
  - `"a"`/`"b"` value pairs: echarts, outputs-model, dataset-row-grid, pipeline-upsertsource-config and
    pipeline-analyze-schema-warnings.
  - The landing page's own `/`: marketing-landing-page, and pwa-installability lines 48 and 79–86, plus its `scope: "/"`.
  - The two allowlisted scenario titles.

  No app-home `/` remains. Before archive the probe returns 50 hits.
- **Other phrasings the probe might miss.** I grepped the archived specs for "app root", "root route", "root path",
  `'/'`, `to="/"`, `navigate("/")` and similar. The only matches were the landing page's own "site root" and
  unrelated uses of "root" (logger, pipeline roots, lockfile). I found no app-home miss.
- **D11 e2e probe.** It returns 94 hits today, all of which the executor retargets. I also searched more broadly for
  `toHaveURL`, regex URLs and `=== "/"`. That turned up only `state-surface-contrast-guard.spec.ts:866/875`, which
  D11 already names (lines 512–875), and an unrelated `cookie.path` "/".
- **Nothing else broke.**
  - D1–D11, the tasks and C1–C9 in tasks.md' Standing Constraints match round 3 and workflow-state.
  - C6 is still marked retired.
  - D12's prose and task 2.11 agree on the order: probe after a local archive dry-run.

### Verdict: CONFIRM

All three round-3 change requests are addressed. The one partial item, the scenario titles, is a real openspec
limitation: I reproduced it, and a second mechanism fails too. The design handles it honestly with an allowlist entry
and a stated reason. The normative bodies are correct. Validation passes, and the literal probe shows no app-home `/`
left after archive.

### Non-blocking notes

- **proposal.md "Modified Capabilities" is stale.** It lists only pwa-installability, frontend-protected-routes and
  frontend-auth-ui, but the change carries 12 MODIFIED deltas. Add the other nine, which D12 names, so the archived
  proposal matches its specs.
- **D12's "Allowed non-route hits today" list is incomplete.** The probe output also includes:
  - pipeline-zero-root-db-guard (`42704`/`22P02`);
  - form-panel-rendering and form-panel-submit (`+`/`-`);
  - the landing page's own `/` in marketing-landing-page and in pwa-installability (lines 48 and 79–86, not just
    `scope: "/"`).

  The executor records a reason for each hit anyway. Expect these groups.
- **Optional cleaner fix for the titles.** After archive, the two living-spec scenario titles could be edited directly
  in `openspec/specs/` as a follow-up commit. That is outside the delta mechanism, so check it against the OpenSpec
  hygiene pre-commit check before relying on it. Leaving the titles allowlisted is acceptable.
- workflow-state.md still has a stale comment, "tasks.md must carry [C1]..[C6]". tasks.md correctly carries C1–C9.
