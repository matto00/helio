## Standing Constraints

- [C1] Do not change request-method sync/async semantics (HEL-1161 scope): no method converted to async; buildUrl tests assert a synchronous throw.
- [C2] Only request paths take `pathSegment` output, interpolated directly as `${pathSegment(...)}`; find comparisons, messages, returned fields and `listAllPanels(id)` keep the raw id (no double encoding).

## 1. Tests (red first, C12)

- [x] 1.1 Write `helio-mcp/src/pathSegment.test.ts`: rejects `..`, `.`, `a/b`, `a?b=1`, `a#b`, `a\b`, `""`, `1/../../tokens` with `HelioInvalidIdError`; passes a UUID and slug unchanged; encodes a space and `%`
- [x] 1.2 Add `buildUrl` tests in `helio-mcp/src/httpClient.test.ts` (or a new file): `//evil.example/x`, `/\evil.example/x` and `/<TAB>/evil.example/x` synchronously throw `HelioRequestUrlError` with zero fetch calls; a normal `/api/x` path is unchanged
- [x] 1.3 Write a tool-level test via `testing/mcpFetchHarness.ts`: a real tool called with `1/../../tokens` returns `isError` naming `HelioInvalidIdError` and the value, with zero fetch calls; `list_source_objects` and `get_dashboard` with that id make zero fetch calls; a UUID id still reaches the expected URL
- [x] 1.3a Unit-test `FamilyClient.rotate` with familyId `..`: returns `{kind:"refused",reason:"unknown"}` and sends no request
- [x] 1.4 Write `helio-mcp/src/requestPathGuard.test.ts` (GUARD) scanning all non-test `helio-mcp/src` `/api/` templates for raw `${...}`, asserting a minimum `pathSegment(` site count equal to the measured post-implementation count
- [x] 1.5 Run 1.1-1.4, confirm each fails for the right reason, save output as `.txt` evidence and commit it before any implementation

## 2. Implementation

- [x] 2.1 Add `helio-mcp/src/pathSegment.ts` (`pathSegment`, `HelioInvalidIdError`); 1.1 goes green
- [x] 2.2 Add `HelioRequestUrlError` and the `//`-prefix + origin check to `buildUrl`; 1.2 goes green
- [x] 2.3 Route all 60 `helioApi.ts` path interpolations and `oauth/familyClient.ts` `rotate` through `pathSegment` (validate first in `getDashboard`/`listSourceObjects`; `rotate` maps the error to refused/unknown); 1.3, 1.3a and 1.4 go green
- [x] 2.4 Mutation checks: revert each rejection branch / the origin check / one call site in turn and record the failing test, as `.txt` evidence

## 3. Verification

- [x] 3.1 Full helio-mcp jest suite (`nice -n 19 npx jest helio-mcp --maxWorkers=3`), `npm run check:helio-mcp-types`, `npx eslint helio-mcp --max-warnings=0`, prettier check on changed files all pass
