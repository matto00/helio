## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD `2c1ab0326fe6c171152bc59ff2918f433558296f`. The change dir is untracked (planning only).
I read ticket.md, workflow-state.md, proposal.md, design.md, tasks.md, all 12 spec deltas and skeptic-design-1/2.md.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/static-marketing-landing-page/HEL-1562`.
- **`openspec validate static-marketing-landing-page --strict`:** printed `Change 'static-marketing-landing-page' is valid`.
- **Constraints:** tasks.md `## Standing Constraints` C1–C9 match workflow-state CONSTRAINTS, with C6 marked retired.
  D5 carries C1, D7 carries C4/C5/C7/C8/C9, and D8 carries C2/C3. Nothing changed here since round 2.
- **The eight new MODIFIED deltas reproduce the original requirement in full.** I checked this mechanically. A
  scratch script pulled each `### Requirement:` block from the delta and from `openspec/specs/<cap>/spec.md` and
  diffed them line by line. Every header resolves in its base spec. The only changed lines are `/` → `/home`:
  - google-oauth-callback-page: lines 5 and 12.
  - mfa-login-verification-ui: lines 3–4 and 14.
  - oauth-error-display: line 15.
  - pipeline-proposal-review-ui: line 10.
  - frontend-pipelines-page: line 9.
  - mobile-dashboard-sheet: both requirements, one line each.
  - mobile-bottom-nav: line 3.
  - frontend-data-sources-page: line 2.

  No scenario was dropped and no other text drifted. The earlier three deltas (auth-ui, protected-routes, pwa) diff
  as round 2 described.
- **Repo-wide probe of living specs for app-home `/` (DEFECT, see CR1).** I ran:

  ```
  grep -rnE '(^|[^`a-zA-Z_])`/`([^`a-zA-Z_]|$)|"/"([^a-zA-Z]|$)|\b(on|to|at|route|home|path|navigates?|redirected?) /([ .,;)]|$)|\(/\)' openspec/specs
  ```

  After removing the noise (compute-expression operators, `"a"/"b"` pairs, `split "/"`, trace-id `/`), these
  app-home hits remain with no delta:
  - `first-run-onboarding/spec.md:219`, requirement "A zero-dashboard workspace lands on the drop zone, with the
    checklist as the step-by-step path", scenario "Empty workspace": "**WHEN** a user with zero dashboards opens `/`".
    This is the app home, which is the `PanelList` empty-workspace surface. After this change, a hard load of `/`
    serves the static landing page. Neither round 2's enumeration nor D12 lists this capability.
  - `mfa-login-verification-ui/spec.md:50`, requirement "Verification step after OAuth callback": "navigate to
    `/login/verify` (not `/`)". The sibling password-path requirement in the same delta file now reads "(not `/home`)".
    After archive the two requirements would disagree.
  - Two scenario titles inside the new deltas still read `/` while their bodies now say `/home`:
    - `frontend-pipelines-page` delta, "Scenario: Breadcrumb shows Dashboards on /", above "WHEN the current route is `/home`".
    - `frontend-data-sources-page` delta, "Scenario: Navigating to / shows dashboard view".
- **D12's probe is not a concrete signal.** Its text and task 2.11 say only "grep `openspec/specs` for app-home `/`
  wording", with no command. The example pattern round 2 offered (`(navigat|redirect|route|on|destinations?)[^.]{0,40}`/``)
  does not match "opens `/`" either. That is how `first-run-onboarding` slipped through both rounds. So the round-2
  requirement for a "probe-backed enumeration" is not yet met.
- **Nothing new broken elsewhere.** D1–D11 and tasks 1.x–3.x are unchanged from what round 2 verified, apart from:
  - the D7 wording fix ("With no stored theme, landing follows the system scheme"),
  - the D8 `@example.test` account domain,
  - D12 and task 2.11.

  These are consistent with the round-2 non-blocking notes and do not contradict anything else.

### Verdict: REFUTE

The eight new deltas are correct and complete for what they cover. One app-home requirement
(`first-run-onboarding`) is still uncovered. The probe meant to make the enumeration trustworthy is unspecified,
and the pattern suggested last round provably misses this hit. The class of defect is the same as round 2's CR1,
so it is not closed. The edit is small: three lines of artifact changes plus one new delta file.

### Change Requests

1. **Add a `first-run-onboarding` MODIFIED delta.** Reproduce the requirement "A zero-dashboard workspace lands on the
   drop zone, with the checklist as the step-by-step path" in full, with the "Empty workspace" scenario reading
   "opens `/home`". Name `first-run-onboarding` in D12's capability list.
2. **Close the in-delta leftovers:**
   - Add a `mfa-login-verification-ui` MODIFIED block for "Verification step after OAuth callback" with
     "(not `/home`)", so it matches the password-path requirement in the same file.
   - Rename the scenario "Breadcrumb shows Dashboards on /" to "... on /home" in the frontend-pipelines-page delta.
   - Rename "Navigating to / shows dashboard view" to "Navigating to /home shows dashboard view" in the
     frontend-data-sources-page delta.
3. **Make the D12 / task 2.11 probe a literal command with a stated pattern** that matches all the forms that exist
   today: backticked `` `/` ``, `"/"`, and "verb /" prose. The command in "What I verified" above is one that does;
   it catches every hit listed in this report and in round 2. Record its output and a per-hit allowlist reason
   (grouping "operator/separator, not a route" is fine) in `files-modified.md`.

### Non-blocking notes

- All round-2 non-blocking notes are handled in the artifacts (the D7 wording and the D8 `@example.test` domain).
  The `jpg` precache exclusion and the `^[^.]*$` caveat need no change.
