## Why

`.github/workflows/ci.yml` selects Playwright specs by an explicit per-file allowlist. It names two specs; `e2e/` contains fourteen. The other twelve are never executed by CI.

An allowlist fails silently. A spec added without a corresponding `ci.yml` edit is simply never run, and nothing anywhere reports that. The result is coverage-shaped disk contents that verify nothing — the same class of blind gate this repo has now found eleven times (tests asserting card count while claiming to test order, a suite never compiling the file under test, a leak check never scanning its target directory, a migration gate running against an empty database, HEL-880's root jest collecting zero tests in a worktree).

HEL-951 was filed against one supposed orphan, `e2e/hel813-mobile-touch-target-floor.regression.spec.ts`. That diagnosis was wrong and the correction is the most important thing in this change: that file is excluded ON PURPOSE, by three independent documented layers, because it writes to real component source on disk (`toast.css`, `PanelList.css`) to prove the steady-state guard is sensitive to known-bad shapes. Wiring it into CI — which the ticket asked for — would place a job that rewrites tracked source files into CI. The product owner reviewed the refutation and approved a restated scope.

The genuine failure is the eleven ORDINARY specs with no exclusion mechanism and no rationale. Those are the silent allowlist.

## What Changes

- **`ci.yml` moves from allowlist to glob.** Playwright is invoked without per-file arguments, so it discovers every spec under `testDir` and honours `playwright.config.ts`'s existing `testIgnore`. A new spec is then run by default, and a spec is excluded only by an explicit, greppable `testIgnore` entry.
- **`testIgnore` becomes the single, documented exclusion register.** Every entry carries a comment naming why it is excluded and, for quarantines, the follow-up ticket that will unquarantine it. An entry without a ticket reference is exactly the silent allowlist this change exists to kill, relocated.
- **The eleven orphans are measured before they are trusted.** They are executed and their status reported as a standalone deliverable. Passing specs are picked up by the glob. Red or flaky specs are quarantined with a filed ticket. Red specs are NOT fixed here: a spec that has never run in CI failing is new information, not this ticket's scope.
- **The regression spec's exclusion is preserved and documented in `ci.yml`.** The comment is the durable fix for the misdiagnosis — it is what stops this ticket being re-filed.
- **The regression harness's Case B is resolved deliberately.** Its anchor control `.panel-list__add` no longer exists in `frontend/src`, so the documented on-demand recipe in `e2e/README.md` is broken today. Case B is either repaired against a genuinely equivalent surviving control — with each repaired assertion mutation-proven red individually — or deleted. Deleting is the correct outcome if no equivalent control survives; an assertion repaired against whatever markup happens to exist today is a tautology wearing a guard's clothes, strictly worse than the rot it replaces.
- **The glob itself is proven to fail loudly.** A throwaway always-failing spec is added, the CI-equivalent invocation is shown to pick it up and go red, and the throwaway is removed. Without this, the change replaces a silent allowlist with an unverified glob and learns nothing until the next audit.

## Capabilities

### New Capabilities

None. This change alters CI invocation and test-harness wiring only; no product requirement changes. `.openspec.yaml` sets `skip_specs: true`.

### Modified Capabilities

None.

## Impact

- `.github/workflows/ci.yml` — spec selection in the `e2e` job.
- `playwright.config.ts` — `testIgnore` gains quarantine entries (if any orphan is red) and explanatory comments.
- `e2e/hel813-mobile-touch-target-floor.regression.spec.ts` — Case B repaired or removed.
- `e2e/README.md` — updated if Case B is removed or its recipe changes.
- CI wall-clock rises: the `e2e` job goes from two specs to however many pass. This is the intended cost of the coverage actually running.
- No production code, no schema, no API surface. No runtime behavior changes.
