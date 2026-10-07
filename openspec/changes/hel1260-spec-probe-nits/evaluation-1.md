## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: f34e9dc3d3df60000809e2bc7551687ac1ed7038. Base resolved live: 5f3990f8ee873b3124e936875bbfb1cef2335d25.
Diff: `e2e/hel1260-orphan-owner-repair.spec.ts` (+3/-2), the archived `probe-check-isolation.py` (+28/-5), plus this change's own
planning artifacts.

### Phase 1: Spec Review — PASS
- AC1: `expect(repairPosts[0].url).toMatch(new RegExp(`/api/dashboards/${escapeRe(dashboardId)}/layout/repair$`))` at
  spec:88-91. It is anchored at the end and the id is escaped. To check that it accepts the same URLs as before, I ran a
  scratch harness comparing the old `endsWith` with the new regex: 396 cases, with ids containing regex metacharacters
  (`.`, `+()`, `[]$^`, `\`, `|{}`), query/suffix/prefix variants and a trailing newline. There were 0 mismatches. JS `$` without the
  `m` flag is a strict end of string, so a trailing `\n` is rejected by both. The diff touches only that assertion site.
- AC2: the probe classifies each trace from the `title` of its `context-options` events. It requires exactly one distinct
  title, checks the file segment, then prefix-matches the last ` › ` segment. A missing, conflicting, wrong-file or
  unclassified title is reported BAD and never given a default.
- AC3: the header comment says the probe is archival and not run by CI, hooks or any gate. It gives the usage, what the
  probe keys on, and both title prefixes.
- AC4: I ran the full spec myself and saw a red with the actual URL printed (see Phase 2 evidence).
- Tasks 1.1-1.7 are all checked and match the diff. Nothing is outside the ticket's scope. `skip_specs` is justified (no product behaviour).
- CONSTRAINTS: C1 is honoured. The helper is inline, immediately before the assertion, and nothing else changed in the spec.
  C2 is honoured. `if o.get('title')` ignores title-less and empty-title events, and the comment at probe:27-28 documents this.

### Phase 2: Code Review — PASS
I ran these gates myself in WORKTREE_PATH. No `frontend/**` or `backend/**` files changed, so I ran the checks that fit the
changed files:
- `npm run lint`: exit 0. `npm run format:check`: all files clean. `npm run check:e2e-types`: exit 0.
  `npm run check:openspec`: "openspec/ is clean". The probe compiles under Python 3.
- Full spec, run as `nice -n 19 playwright test e2e/hel1260-orphan-owner-repair.spec.ts --workers 3 --trace on`
  against lane servers 6734/9641: **4 passed** (orphan light/dark, UI-create light/dark), exit 0. The servers were reused,
  so I checked their owner via `/proc/<pid>/cwd`. Both run from this worktree (`.../HEL-1302/frontend` and `.../HEL-1302/backend`).
- **URL-assertion red, reproduced independently.** I made a mutated copy of `e2e/` outside the worktree (`/layout/repairX$`) and
  ran it with the same config against the lane servers. It failed with
  `Expected pattern: /\/api\/dashboards\/dc0e70e3-...\/layout\/repairX$/` and
  `Received string: "http://localhost:6734/api/dashboards/dc0e70e3-.../layout/repair"`, exit 1. The actual URL is printed.
- **Probe red, against the old probe.** I took my real traces and copied the orphan trace into a folder whose name contains
  `survives`, and the UI trace into a folder whose name does not. The old probe (taken from the base commit) got both wrong
  (`ui test repairs 1`, `repair count 0`, 2 bad). The new probe classified both correctly (`[orphan]`, `[ui]`).
- **Probe on the real output:** 4 traces, 0 bad, each classified correctly.
- **Synthetic negatives:** each of these traces was reported BAD:
  - title removed: `no title`
  - empty-string title: `no title`
  - two distinct titles across `.trace` files: `conflicting titles=[...]`
  - file renamed to `other.spec.ts`: `wrong file=other.spec.ts:37`
- Code quality: no type escape hatches, no dead imports. A few awkward constructs remain in the archived script (see
  suggestions). None of them changes behaviour.
- I cleaned up all scratch artifacts, including a `__pycache__` that my own `py_compile` check created. The worktree's
  `git status` is clean.

### Phase 3: UI Review — N/A
No UI trigger paths changed: no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` files. The e2e
behaviour was checked live in Phase 2.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `probe-check-isolation.py`: `if kind is None: pass` followed by `elif ...` and the leftover `if True:` block is awkward
  control flow. You could write `elif kind is not None and (len(blank) != 1 ...)` and drop the `if True:` wrapper.
  This is only cosmetic in an archival script.
- verification.md 1.3 says `--workers 3` while the run output says "using 1 worker". The cap comes from the Playwright
  config, so this is harmless, but the record could note it.
