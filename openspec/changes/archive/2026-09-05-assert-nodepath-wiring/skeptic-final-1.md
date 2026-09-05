## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit under review: `6516f389`. Note the worktree's local `main` ref is stale
(`56875fdc`); the branch's real base is `431d86de`. All diff claims below are
against `431d86de...HEAD`, not the stale ref.

### What I verified (with evidence)

**Scope / AC6 — no product-file diff.**
`git diff 431d86de...HEAD --name-only | grep -v -E '^openspec/|\.test\.tsx$'`
returned nothing. The whole branch is `PipelineRiverView.test.tsx` (+167) plus
openspec docs. No testability seam was needed at all — `nodePath` was already
exported and the `title` attribute already rendered, so AC6 is met in its
strongest form (zero non-test edits).

**Baseline.** `npx jest --testPathPatterns="PipelineRiverView"` → 30 passed.

**AC3 — call-site mutation is red.** I mutated the call site myself, twice, in
two independent forms (not the executor's recorded mutation):

- *1a, subtlest form* — `PipelineRiverView.tsx:294` changed to
  `entries[step.id] = step.id;` (well-typed, keeps the `title` attribute
  present, mimics `nodePath`'s own unresolvable-data fallback). Result:
  **6 failed / 24 passed**. Failures are value mismatches
  (`Expected "root:root-1 > r1a" / Received "r1a"`), i.e. the element was
  found and the attribute was present — the failure is attributable to the
  wiring, not to a malformed fixture.
- *1b, deletion form* — line 294 replaced with `void steps;` so the map is
  empty and `title` is absent. Result: **6 failed / 24 passed** with
  `No title-bearing ancestor for "Trunk one"`. This is the case I specifically
  probed for: `titleFor` uses `closest("[title]")`, so a stray outer ancestor
  carrying a `title` could have swallowed the mutation. It does not — no
  fallback ancestor exists, and the guard's explicit `throw` gives an
  unambiguous message rather than a silent pass.

Critically, in **both** mutations the fixture-integrity test ("renders the
expected shape before any title is asserted") stayed **green**, which is what
separates a real wiring failure from a broken fixture.

**AC4 — function mutation is red, via NEW HEL-985 assertions.** I ran only
`--testPathPatterns="PipelineRiverView"`, deliberately excluding the
pre-existing `state/nodePath.test.ts`, so the pre-existing unit test could not
carry the verdict:

- Head break (`root:${bestRootId}` → bare `"root"`, the exact HEL-911 stale
  format): **6 failed / 24 passed**, `Received "root > r1a"`.
- Hop-order break (trail reversed): **4 failed / 26 passed**,
  `Received "root:root-1 > r1c > r1b > r1a"`. The guard pins hop order and the
  `" > "` separator, not just the head.

**AC1 / AC2 — coverage of every rendered site.** `grep -n "nodePath"` across
`PipelineRiverView.tsx`, `LaneColumn.tsx`, `RootColumn.tsx` finds exactly three
`title=` sites: `PipelineRiverView.tsx:381`, `LaneColumn.tsx:171` (compact),
`LaneColumn.tsx:216` (non-compact). All three are asserted, plus both threading
paths that reach them (`RootColumn.tsx:114` for a second root, `LaneColumn.tsx:146`
for a lane nested under a lane). The fixture is genuinely two-root and
multi-hop: it produces both a `root:root-1` and a distinct `root:root-2` head,
a base case one hop from the root, and a six-hop chain. That covers AC1's
"root-level base case and a multi-level lane chain" and AC2's "every rendered
title site".

**AC5 — reverted, clean, green.** After restoring both files:
`git status --porcelain` shows only the untracked `evaluation-1.md`;
`git diff --stat` is empty. Full gates on the restored tree:
lint (`--max-warnings=0`) clean, `tsc --noEmit` clean, `prettier --check`
clean, and `npx jest` → **256 suites / 2646 tests passed**.

**UI/design judgment — N/A.** Test-only change; no rendered product behavior,
markup, or token usage is altered (verified by the empty product diff), so
there is no view to screenshot and no design-standard surface to judge.
I did not start the dev servers, deliberately — there is nothing they could
show that the empty product diff does not already settle.

**The specific trap this ticket guards against.** The question was whether the
new guard is itself evidence-shaped non-evidence — coverage that looks real but
survives the mutation it claims to catch. It is not. I reproduced red under
three independent mutations I wrote myself, in both the call-site and the
function, with failure messages attributable to the wiring, while the
fixture-shape test stayed green throughout. That is the property the ticket
asked for, demonstrated rather than asserted.

### Verdict: CONFIRM

### Non-blocking notes
- `titleFor`'s `closest("[title]")` is safe today because no ancestor of a step
  card carries a `title`. If a future change adds a `title` to an outer
  container (e.g. a lane or root column tooltip), mutation 1b's deletion form
  would start passing silently. A `data-testid` on the step card, or scoping
  the `closest` search, would remove that latent dependency. Not blocking —
  the current DOM makes it correct, and the value-mismatch mutation (1a)
  catches the neutering case regardless.
