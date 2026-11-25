## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `d3ccfda244c49fe48a17e6441451d8551011af4d` (base `95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c`, resolved live with `resolve-review-base.sh`).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (every request-path id goes through the helper, plus a GUARD): I enumerated the sites myself rather than relying on the GUARD.
  - Every `this.http.*` call in `helioApi.ts` takes a string literal (29) or an `` `/api/...` `` template (57). There are no variable or concatenated paths.
  - No other module calls `HelioHttpClient` verbs.
  - The only other request builders are `oauth/familyClient.ts`, whose one id site now uses `pathSegment`, and `oauth/patCheck.ts`, which uses the constant `/api/tokens`.
  - The count is 62 `${pathSegment(` sites in `helioApi.ts` plus 1 in `familyClient.ts`, which is 63 and equals `MIN_SITES`. Two of the 62 are the non-request `HelioApiError` path labels (`getDashboard`, `listSourceObjects`).
- AC2 (unit tests): `..`, `.`, `a/b`, `a?b=1`, `a#b`, `a\b` and `""` are all rejected with `HelioInvalidIdError`. A UUID and slugs pass unchanged. A space and `%` are encoded. Each case is failable by mutation (see Phase 2).
- AC3 (`buildUrl`): `//evil.example/x`, `//helio.test/x`, `/\evil.example/x` and `/<TAB>/evil.example/x` all throw `HelioRequestUrlError` synchronously and send nothing. `post` and `postMultipart` are covered too. A normal path is unchanged.
- AC4 (tool level): `get_pipeline`, `list_source_objects` and `get_dashboard` called with `1/../../tokens` return `isError`. The result names `HelioInvalidIdError` and the value, and the fake fetch is never called. A UUID still reaches `/api/pipelines/<id>` and `/steps`.
- AC5: gates pass (Phase 2).
- C1: no method was converted to `async`. The diff adds no `async` or `Promise.resolve/reject`, and the `buildUrl` tests assert a synchronous throw.
- C2: every request path interpolates `${pathSegment(...)}` directly. The `find` comparisons, the "No ... with id" messages, the returned `id`/`pipelineId` fields and `listAllPanels(dashboardId)` keep the raw id. The two `HelioApiError` path labels use the encoded form. Those are paths, not messages, and the id has already been validated, so this does not violate C2.
- Scope: changes stay within `helio-mcp/src` plus the change directory. There is no backend, frontend, schema or deploy change. All tasks are checked and match the code.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates were re-run by me in WORKTREE_PATH at d3ccfda24. The helio-mcp gates are the ones the orchestrator and design.md name, because helio-mcp matches neither the `frontend/**` nor the `backend/**` trigger.

- `nice -n 19 npx jest helio-mcp --maxWorkers=3`: 76 suites and 689 tests passed (exit 0).
- `npm run check:helio-mcp-types`: exit 0.
- `npx eslint helio-mcp --max-warnings=0`: exit 0.
- `npx prettier --check <changed files>`: exit 0.

I reproduced the red myself. I restored the base `helioApi.ts`, `httpClient.ts` and `familyClient.ts`, removed `pathSegment.ts`, and ran the new tests. The result was 5 suites failed, 6 tests failed and 2 passed, which matches `evidence/red-run.txt`. The failures are for the right reasons:

- the GUARD flags 63 raw `${...}` expressions;
- `list_source_objects` and `get_dashboard` produce `HelioApiError 404 for /api/.../1/../../tokens` after a list request;
- `get_pipeline` returns `isError` undefined, because the request went out;
- `familyClient.rotate` returns something other than refused/unknown.

Two suites (`pathSegment.test.ts`, `httpClient.originGuard.test.ts`) are red only by compile error, since their symbols do not exist yet. Their behaviour is proven red by the mutations below. The red evidence was committed together with the implementation. That is acceptable because the red reproduces on demand from the base sources.

I ran 16 mutations of my own. Each one was applied, run against its targeted test and restored with `git checkout`, and every one went red for the expected test:

| Mutation | What it did | Result |
| --- | --- | --- |
| M1 | drop the `..` check | red |
| M2 | drop the `.` check | red |
| M3 | drop the `""` check | red |
| M4 | drop `\` from FORBIDDEN | red |
| M5 | drop `#` from FORBIDDEN | red |
| M6 | drop `?` from FORBIDDEN | red (2 tests) |
| M7 | return the value unencoded | red |
| M8 | disable the origin compare | red on the `/\` and TAB cases |
| M9 | disable the `//` prefix check | red on `//helio.test/x` (same origin, so only the prefix check catches it) |
| M10 | a raw `${outputId}` in `getOutputInsight` | GUARD red |
| M11 | revert the familyClient site to `encodeURIComponent` | GUARD red |
| M12 | remove the familyClient `HelioInvalidIdError` catch | red |
| M13 | remove getDashboard's validate-first line | red |
| M14 | remove listSourceObjects' validate-first line | red |
| M15 | point the GUARD's SRC at `testing/` | "not vacuous" count assertion red |
| M16 | break the GUARD's template regex | count assertion red |

The GUARD is therefore not vacuous: both a wrong scan root and a wrong pattern fail it. Scratch output is in `/home/matt/Development/helio/.concertino/scratch/HEL-1160/` (mut-*.txt, eval-*.txt). The worktree was clean afterwards (`git status --short` was empty, HEAD unchanged).

The code-quality checks found nothing:

- The helper is small and typed.
- Both error classes have a `name` and readonly fields.
- No `any`, dead code or TODO.
- The origin check compares origins only (the HEL-1161 path prefix is left alone, as designed).
- `familyClient.rotate` maps an invalid id to refused/unknown before any fetch, and rethrows anything else.

### Phase 3: UI Review — N/A
Changed files match none of the triggers (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). No servers were started.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- The GUARD only scans template literals that begin with `/api/`. A future site that builds a path by concatenation (`"/api/x/" + id`) or with a prefixed template (`` `${base}/api/x/${id}` ``) would escape it. There are no such sites today (I verified this by hand). A follow-up could add a second assertion that every `this.http.<verb>(` first argument is a string literal or an `/api/` template.
- `familyClient.post` builds `${apiBaseUrl}${path}` without the `buildUrl` origin check. design.md accepts this as out of scope, and its paths are constants plus the validated id.
- The tool-level test exercises only the traversal value. The `?`, `#`, `\` and `""` rejections are proven at unit level, and the error path they share with the traversal value is proven at tool level, so the spec scenarios are covered in combination.
