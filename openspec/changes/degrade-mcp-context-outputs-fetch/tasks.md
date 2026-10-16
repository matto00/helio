## Standing Constraints

- [C1] Red first: the crash reproduction must be shown failing on unmodified `context.ts` before the fix lands.
- [C2] The fix must be proven WITHOUT the unhandledRejection safety net installed.

## 1. Red reproduction

- [x] 1.1 Add the seam test (MCP client, real HelioHttpClient, 429 past budget on data-sources and outputs list); run
  it against unmodified `context.ts` and record the red output.
- [x] 1.2 Subprocess reproduction on Node 22: unfixed code exits non-zero with an unhandled `HelioRateLimitError`;
  record the transcript.

## 2. Fix

- [x] 2.1 Self-catch the Outputs promise in `buildWorkspaceContext`; add optional `outputsError` to
  `WorkspaceContext`; correct the misleading comment.
- [x] 2.2 Unit test: Outputs-only failure yields `outputsError` and `outputs: []` on every pipeline; success path has
  no `outputsError`; concise mode/budget keep it.
- [x] 2.3 Extract and install the `unhandledRejection` guard in `main()`; unit-test it logs bounded stderr and does
  not exit.

## 3. Green and docs

- [x] 3.1 Re-run 1.1 and 1.2 on the fix; record green.
- [x] 3.2 README: contract-change note for HEL-1524 `expectedLayoutVersion`; mention `outputsError` where the
  workspace context is documented.
- [x] 3.3 Gates: helio-mcp typecheck, lint, prettier, the helio-mcp jest tests.
