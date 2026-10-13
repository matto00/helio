## Standing Constraints

## Driver Rules (overnight, binding)

- Red first: the repro tests (1.1) must fail on unmodified main, with the failing output captured in the run evidence.
- New backend specs use `VerifiedEmbeddedPostgres.start`; `[hel1468-guard]` must appear in sbt output; no inline FQNs.
- Never act as matt@helio.dev; register a throwaway `@example.test` user and verify via `/api/auth/me` before probes.
- `nice -n 19` heavy jobs; check MemAvailable (wait under ~15 GB); at most one full `sbt testFull` from this lane;
  shut down every sbt server started; no pkill/pgrep/killall; no `--no-verify`/`HUSKY=0`; `git -C`, not `cd`.

### Backend

## 1. Reproduce (red)

- [x] 1.1 Add backend specs reproducing both defects on main: preview→rename panel via PanelService→apply overwrites; preview→change step config→apply delete removes it; verify they fail before the fix
- [x] 1.2 Reproduce the Back-re-apply variant once (component test or live) and record the result in evidence

## 2. Fingerprint and check

- [x] 2.1 Add `PatchSetTargetFingerprint` (D2 table exactly, canonical JSON, `v1:` sha256; output-delete config read) and verify unit tests
- [x] 2.2 Add optional `fingerprint` to `EditTarget` reader/writer and `EditPreview`; reject it on create (400) at RESOLUTION, never in the JSON reader; verify protocol round-trip tests
- [x] 2.3 Emit fingerprints from preview for update/delete edits via the shared helper; verify preview spec
- [x] 2.4 Compare supplied fingerprints in `PatchSetApplyService.apply` after resolveAll, collect all mismatches, return `ServiceError.PatchSetStale`; verify 1.1 turns green
- [x] 2.5 Render `PatchSetStale` as 409 `{message, code: "PATCH_SET_STALE", staleTargets}` in `ServiceResponse`, message naming each stale edit/kind/id; verify route-level test
- [x] 2.6 `RefinementService`: strip model fingerprints, preview, stamp by index (returned + stored `latestPatchSet`); `AssistantToolExecutor` strips before preview; add `fingerprint` to `AssistantProposalToolSchemas.EditTargetSchema`; verify specs
- [x] 2.7 Update `schemas/patch-sets/patch-set.schema.json` and `patch-set-preview-response.schema.json` + a new `schemas/shared/` 409 body schema (mirror `step-config-error-response.schema.json`); verify schema-drift check passes

### Frontend

## 3. Review page

- [x] 3.1 Add `fingerprint` to frontend `EditTarget`/`EditPreview` types and typed 409 rejection in `patchSetsSlice`; verify slice tests
- [x] 3.2 `PatchSetReviewPage`: stamp preview fingerprints on Apply, conflict notice + Re-preview, Apply disabled while previewing, `navigate("/", { replace: true })` on success; verify component tests

## 4. helio-mcp

- [x] 4.1 Add `fingerprint` to `editTargetSchema` and `types.ts`; document 409 in `apply_patch_set` description; verify a mocked 409 body's message (naming stale targets) reaches the tool error text

### Tests

## 5. Coverage

- [x] 5.1 Backend: unchanged→200; no fingerprints→legacy 200; stale update/delete→409 and NO edit applied (assert every target, incl. non-stale ones) and nothing journaled; create+fingerprint→400; pipeline run between previews→same fingerprint; each allowlisted field mutation→fingerprint changes (mutation-failable)
- [x] 5.2 Seam: a patch set produced by the frontend apply path and by MCP (with `target.fingerprint`) validates against `patch-set.schema.json` and decodes in the backend protocol
- [x] 5.3 Frontend jest + MCP tests for conflict, re-preview, replace-navigation, fingerprint forwarding
- [x] 5.4 Run affected sbt suites (patchsets + refinement), frontend lint/typecheck/test, helio-mcp tests; record outputs in run evidence
