## Standing Constraints

- [C1] Edit ONLY `schemas/pipelines/pipeline-analyze-proposal-response.schema.json` (plus ticking boxes here and writing
  `files-modified.md`). Change only the two description substrings in design.md D2; no other byte of the schema.
- [C2] Never `git stash`; never `--no-verify`/`HUSKY=0`. Use absolute paths / `git -C <worktree>`; shell vars do not
  persist between Bash calls.

### Backend

- [x] 1.1 Edit tool on the schema file: replace design.md D2 block A-OLD with block A-NEW (copy each block verbatim).
- [x] 1.2 Edit tool on the schema file: replace design.md D2 block B-OLD with block B-NEW (copy each block verbatim).
- [x] 1.3 Verify `grep -ci stale <schema file>` prints `1` (the untouched HEL-1235 `warnings` line) - was `3`.
- [x] 1.4 Verify `grep -ci 'op/string\|predates\|deliberate divergence' <schema file>` prints `0`; `grep -c HEL-1281 <schema file>` prints `2`.

### Tests

- [x] 2.1 `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' <schema file>` exits 0, no output.
- [x] 2.2 `git -C <worktree> diff --stat -- schemas/` last line is exactly ` 1 file changed, 2 insertions(+), 2 deletions(-)`.
- [x] 2.3 In the worktree `npm run check:schemas` exits 0; its first `schemas in sync` line reads `(122 checked across 54 protocol files)`.
- [x] 2.4 In the worktree `npx prettier --check schemas/pipelines/pipeline-analyze-proposal-response.schema.json` prints `All matched files use Prettier code style!`.
- [x] 2.5 Tick boxes 1.1-2.5 here, write files-modified.md, commit `HEL-1281 Correct stale AnalyzeStep wording in proposal analyze schema` (full hook, no bypass).
