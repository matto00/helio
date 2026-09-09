# MISTAKES.md

Tripping hazards specific to this repository — things that **look correct and are
not**, or that fail silently rather than loudly. Each entry has cost real time at
least once.

This is not a style guide (`CONTRIBUTING.md`), a design standard (`DESIGN.md`), or
a workflow (`CLAUDE.md`). It is the list of traps. Read it before an unattended
batch run; most of these bite hardest when nobody is watching.

---

## Verification

### A green test suite certifies less than you think

Recurring, across many tickets. The defects that ship look **identical to working
software**: a registry that records nothing looks like an empty history; a search
that never indexed looks like an empty workspace; a result row that goes nowhere
looks like a row you mis-clicked.

- **jsdom cannot see focus or visibility.** `toHaveFocus()` and visibility
  assertions in `frontend/src` are frequently vacuous — they pass on markup no
  user could reach. Rendered measurement (Playwright + computed style) is the only
  evidence for anything visual, focus-related, or size-related.
- **`document.fonts.check()` is vacuously true** in jsdom.
- **A guard that cannot fail must not be written.** Every guard needs a mutation
  that turns it red, and the recorded proof must be the mutation that actually
  exercises _that_ guard — a plausible-looking mutation frequently exercises a
  different branch.
- **A guard is only as good as the invariant someone named.** A guard asserting
  "an explanation is always present" passed while the table shell rendered at 7px,
  because nobody had named "the table shell survives". When commissioning a guard,
  enumerate what else could break in the same region and still pass.
- **An exception pinned in a guard must be able to expire.** Pin it with a
  staleness check that goes red when the pin no longer matches, or the exception
  outlives its reason.

### CI is the first real measurement

Local gates all run on one machine, in one working tree, with warm caches. They
are structurally blind to collision- and timing-dependent defects.

Two real examples: two test files whose basenames differed only by extension
(`resourceNavigation.test.ts` / `.tsx`) compiled to the same output path, so
ts-jest silently dropped one emit — it passed locally on **every** run including
`--no-cache`, because the collision resolves by module-map ordering. The tell was
a suite failing with **zero failing tests** and a test count one lower than local.

### Read values from source; never transcribe them

Hand-copying a token value, a hex, or a measured figure into a script produced
three confidently-wrong results in one batch. Parse it from the file.

Related: **a check is only "mechanical" if its input set was enumerated
mechanically.** A hand-picked list fed to an automated comparison is a manual
check wearing a machine's clothes.

### Enumerate by what renders, not by which token is named

A name-based grep cannot see a `color-mix()` derivative, a token alias
(`--app-info: var(--app-accent)`), a `::selection` background, or a class
assembled from a template string. Worse, **narrowing a grep to fix one false
positive creates a blind spot that is invisible because the narrowing was
justified** — anchoring a search to `var(--app-accent)` to stop it matching
`border-color` is exactly what hid 8 failing `--app-accent-strong` sites.

---

## Data and persistence

### `spray-json` omits `Option = None` on the wire

An absent field and a null field are different, and the frontend sees neither.
**Normalize at the service boundary**, and write tests with the field _absent_,
not merely null. This has bitten at least three times across separate epics.

### Appearance/config PATCH is a replace, not a merge

`mergeConfig` shallow-merges (`existing.fields ++ patch.fields`); only
`legend` / `tooltip` / `seriesColors` / `axisLabels` are deep-merged. A partial
patch to any other nested object **replaces** it wholesale.

### Schema inference from row 0

Inferring a schema or a column set from the first row silently drops sparse
columns and mis-declares nullability. Merge across sampled rows with type
widening.

---

## Database and environments

### Every worktree shares one Postgres database

Parallel runs share `flyway_schema_history`. A stale pre-fix migration from one
ticket has poisoned a _different_ ticket's dev-server gate. If a migration fails
inexplicably, check what another worktree has applied.

The shared dev DB is also mostly test residue, and runs leave real persisted side
effects behind (panel resizes, filters). Clean up anything a later reader would
misread as a bug — a live no-match filter on a shared dashboard reads as broken.

### RLS policies never run in dev or CI

Both connect as a superuser, which is `BYPASSRLS`. **Every local and CI check
masks an RLS defect**, and Flyway in production runs as the non-bypassing `helio`
role. This caused a production outage (HEL-286) and three failed deploys during
the v0.7.x remodel. Postgres versions also drift across dev/CI/prod.

A "CORS error" in the browser is usually a backend 500 that lacked the CORS
header — read the backend log, not the browser message.

---

## Delivery and release

### `main` requires `ci-complete`; direct pushes are rejected

Verified 2026-09-09 against the live rulesets. Three are active:

- **`main - no delete`** — applies to the default branch: no deletion, no
  non-fast-forward, and **`ci-complete` is a required status check**. A direct
  `git push origin main` is rejected outright; changes reach `main` through a PR.
- **`Release branch protection`** — `refs/heads/release/**`: no deletion, no
  non-fast-forward.
- **`Version tag protection`** — `refs/tags/v*`: creation, deletion and update are
  all restricted. `cut-release.sh` therefore pushes its tag through an **owner
  bypass**, and the push output says so (`Bypassed rule violations for
refs/tags/v0.7.17`). That line is expected, not a misconfiguration.

**Historical note, because the old rule is still quoted:** there was previously no
branch protection at all, which made `gh pr merge --auto` dangerous — it merged
instantly rather than waiting. That is no longer true; with `ci-complete`
required, `--auto` waits for it. Watching checks and merging manually is still a
reasonable habit, and it is what the agent-merge path does, but the _reason_ has
changed — do not repeat the "no branch protection" claim without re-checking.

### Poll CI by the exact head SHA, never "the newest run"

The newest run on `main` may belong to a different commit. After a rebase, poll
the **post-rebase** SHA.

### A commit landing after the evaluator's PASS is reviewed by nobody

Verdicts are recorded against a run, not a commit. Check which SHA the evaluator's
report names before treating its PASS as covering your head. (Tracked upstream as
CON-166.)

### The backend CI job takes ~12 minutes

Roughly 2× the merge-readiness script's default poll window, so a healthy PR
routinely produces a false "CI pending" escalation. (Fixed upstream as CON-159;
reaches this repo only via `concertino sync`.)

### Tag pushes deploy; never hand-roll a tag

Cut releases with `scripts/release/cut-release.sh <major.minor>`. Hand-tagging
skips the release-branch fast-forward and the GitHub Release — eight `v0.7.*`
tags have no Release because of exactly this. Verify with
`scripts/release/audit-releases.sh`; **a successful deploy is not evidence the
release was cut correctly, the audit is.**

### The security gate is unconditional on high/critical

`audit-ci` runs with `"high": true` and an empty allowlist in **both** the root
and `frontend/` trees. A newly-published advisory turns every open PR red with no
repository change — "nothing moved, the world did". Check both trees; an advisory
may span two major ranges (js-yaml affected both 3.x and 4.x, with a separate
override floor for each).

---

## Tooling

### `scripts/concertino/` is a render target

A hand-edit there is silently erased by the next `concertino sync`. Fixes go to
`~/Development/concertino`. Sync is manual in this repo (`cleanup.skipSync: true`).

### `start-servers.sh` may reuse a stale server

It reports "already healthy, reusing" without checking what that process is
serving. **Verify the process cwd is your worktree** (`readlink /proc/<pid>/cwd`)
before trusting anything you observe — otherwise you may be reviewing another
branch's binary. (CON-155.)

### Never invoke `npm` / `vite` / `sbt` / `npx playwright` bare

A bare invocation inherits an ambient default instead of the run's pinned config.
`vite.config.ts` falls back to port 5173 and auto-increments into another
worktree's range, so the run measures someone else's server. The same class has
stranded uncommitted work in the **main checkout** instead of a worktree.
(CON-165.)

### Parallel Playwright sessions share one browser

A peer session can steal the tab mid-run. Re-check `location.href` before every
reading and self-authenticate page content — a port check is not enough.
Screenshots also leak to the repo root; they are gitignored but accumulate.

### Linear: closing an epic cascades to its children

Setting an epic Done auto-closes **every open child** about a quarter-second
later. This silently marked six unbuilt tickets as shipped. Enumerate children
first — including any outside the current project, which will not appear in a
milestone-filtered view.

Also: `save_comment` with an `id` **replaces** the body (data loss), and a
`parentId` cannot be cleared once set.

---

## Process

### Validate the ticket's premise before building

Gates check the work against the ticket; **nothing checks the ticket against
reality**. Measured premises that were wrong: "17 files" (was 29 strict / 40
loose), "plausibly one token" (was 17 sites across 8 stylesheets), "2 known
remaining call sites" (was 54 files). Probe first, and rescope openly if the
premise fails.

### Report an unverifiable acceptance criterion as unmet

Do not soften it, and do not let a passing gate stand in for it. Several tickets
have closed honestly on an unmet AC, and that was right each time.

### Corrections replace decision text; they never accumulate beneath it

A superseded ruling left in place with a correction appended below it reads as
commentary on a live decision. A reader who stops at the heading gets the wrong
answer — and stopping at the heading is the expected reading behaviour.

Related: identifiers in a decision document (`D1`, `D2`, …) are **identifiers, not
positions**. Never renumber — a reference that resolves to the _wrong_ section is
caught by nobody, unlike a dangling one. Retire a removed number with a tombstone.

### A commit message is the one artifact never verified against reality

Gates check the diff, and an edit that silently no-ops produces no diff to check.
A commit message asserting a change that did not land will be read later by
someone reconstructing intent, at the moment they can least easily check it. Make
edits assert on their anchors, and verify the post-edit state.

### When a diff shows a regression, establish which side moved

`main` advancing reads exactly like your branch regressing. Confirm before naming
a cause — a confident wrong mechanism gets acted on.

### Route findings out; name the obligation, not the component

A ticket about the same _component_ is not a ticket about the same _contract_.
Focus indicators at 3:1 and accent text at 4.5:1 are different obligations and
belong in different tickets.
