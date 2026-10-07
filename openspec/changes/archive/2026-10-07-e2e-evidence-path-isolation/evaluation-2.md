## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: 1ba2fbf76e5500b550181430c7f85e28f0f275f8. Base (resolved live by resolve-review-base.sh): 33dcf8fd22fe21f4823697aec101033e7f637c30.
This cycle reviews the delta 0f695ad3d..1ba2fbf76 against the change requests in evaluation-1.md.

### Phase 1: Spec Review — PASS

Issues: none.

- **CR1 (guard covers the whole `openspec/` tree): resolved.** Rule (a) in `scripts/check-e2e-evidence-paths.mjs:94-104` now matches two shapes on comment-stripped text:
  - the substring `/openspec\//`
  - a standalone quoted segment `/(["'`])openspec\1/`

  Each line is reported once. I ran the guard myself against small fixture files; each exit code is shown below:
  - `writeFileSync` into `../openspec/specs/...`: 1
  - `join(__dirname, "..", "openspec", "changes", "x")` + `mkdirSync`: 1
  - `page.pdf` into `../openspec/`: 1
  - `download.saveAs` into `openspec/...`: 1
  - `recordVideo.dir` under `openspec/`: 1
  - a template-literal `` `openspec` `` segment: 1
  - a clean file: 0
  - The real tree is still clean: 60 files scanned.
- **CR2 (red selftest cases + mutation proof): resolved.** The selftest gained three red cases (`selftest.mjs:80-94`) and passes 15/15. `mutation-cr2-rule-a.txt` records 3 failures when rule (a) is reverted. I reproduced this myself: I copied the guard to the scratchpad with rule (a) reverted to `/openspec\/changes/g`. The join-segment fixture then exited 0; the real guard exits 1 on it. The scratch copy was removed afterwards.
- **CR3 (artifacts match the restated ticket): resolved.** These now state the `openspec/` scope:
  - ticket.md AC1/AC2
  - design.md D3/D4
  - proposal.md
  - the spec delta, which gained two scenarios: a path-segment `mkdirSync` and a non-screenshot `writeFileSync`

  The restated ticket's "stops a spec from writing under `openspec/` … prove it with a red run" is now met.
- Carried over from cycle 1, unchanged:
  - AC3: verified live in cycle 1; check:openspec selftest 21/21 again this cycle.
  - AC4: helper probe from cwd `/` in cycle 1; helper unchanged since.
  - Scope of the 10 spec files: unchanged since cycle 1.
- CONSTRAINTS: `[]`.

### Phase 2: Code Review — PASS

I ran the gates fresh in WORKTREE_PATH. No `frontend/**` or `backend/**` file changed, so npm test, the frontend build and sbt were not triggered. All of these exited 0:
- `check:e2e-evidence-paths`: 60 files
- `check:e2e-evidence-paths:selftest`: 15/15
- `check:openspec`
- `check:openspec:selftest`: 21/21
- `check:e2e-types`
- `format:check`
- `lint`

The entry guard at `scripts/check-e2e-evidence-paths.mjs:181-185` now uses the realpath + `pathToFileURL` form. I verified it two ways:
- Invoking the guard through a symlink still runs `main()`: exit 1 on a red fixture.
- A fixture root containing a space is still checked: exit 1.

No CONTRIBUTING [mechanical] violations found in the delta.

### Phase 3: UI Review — N/A

No UI-affecting files changed. Per the driver's rules, I did not use a browser.

### Overall: PASS

### Non-blocking Suggestions

- The entry guard has no independent backstop like the one in `check-no-credential-in-agent-surface.mjs`. If the comparison were ever false while this file is the entry point, the guard would exit 0 silently. The selftest's red cases spawn the guard the same way, so the selftest would still catch it.
