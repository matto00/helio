## 1. Gate script

- [x] 1.1 Read each surface's collected files in one place; on read failure append an error naming the file and
      error code, and exclude it from the counted list. Verify: `chmod 000` a planted `helio-mcp` file and confirm
      non-zero exit with that file named.
- [x] 1.2 Make `findBannedImport` surface a read failure as an error instead of `continue`. Verify: an unreadable
      transitively-imported module under `frontend/src` yields a non-zero exit.
- [x] 1.3 Add the `mainRan` flag and the independent basename-based entry test that errors when the module was the
      process entry but `main()` never ran. Verify: a copy with the strict comparison forced false exits non-zero.
- [x] 1.4 Make `collectFiles` report a `readdirSync` failure as an error rather than returning silently, keeping the
      missing-root case routed to the vacuity check. Verify: `chmod 000` a directory under
      `frontend/src/features/assistant/` and confirm non-zero exit naming it.
- [x] 1.5 Report access errors first, in the same early-exit batch as drift and vacuity (order: access, drift,
      vacuity). Verify: a surface whose every file is unreadable fails naming those files, not only VACUOUS.
- [x] 1.6 ADD header notes recording which paths HEL-993 closed (file read, directory listing, entry guard) and
      correct the entry-guard comment's "fixed rather than left as a residual" claim. Leave the three existing,
      still-true entries in the "Other known residual limits" block intact.
- [x] 1.7 Verify the clean-tree line is still `OK (82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 0
      violations)` at exit 0.

## 2. Self-test

- [x] 2.1 Add an unreadable-file case (plant a credential-shaped literal under `helio-mcp/`, `chmod 000`, expect
      non-zero; restore mode and remove; expect zero). Print an explicit SKIP line when euid is 0.
- [x] 2.2 Add an entry-guard case using `runMutatedScript` to force the comparison false; expect non-zero and a
      diagnostic, not a silent zero exit.
- [x] 2.3 Add an `importGraph` case planting an assistant-surface module that transitively imports a banned
      component; expect non-zero naming the chain, then zero once removed.
- [x] 2.4 Add a `credentialProp` case planting an assistant-surface module declaring a property named `credential`;
      expect non-zero naming file and line, then zero once removed.
- [x] 2.5 Add a case for the import-graph BFS read failure: plant an assistant-surface module importing a second
      planted module, make the imported one unreadable, expect non-zero naming it; restore and expect zero.
- [x] 2.6 Add a case for an unlistable directory under a surface root (`chmod 000`), expecting non-zero naming the
      directory; restore mode and expect zero. Same euid-0 SKIP handling as 2.1.
- [x] 2.7 Register every new planted path in `.gitignore` by explicit path, matching HEL-956's existing convention
      there. Verify: `git status --short` is clean immediately after a full self-test run.
      EVIDENCE (skeptic-final-1.md CR2, re-verified after fix): `git check-ignore -q` returns 0 for all 9
      planted paths, including `helio-mcp/.hel993-only-file.ts` (missing on the first commit; added) and
      `frontend/src/shared/.hel993-bfs-unreadable.ts` (path changed by the BFS-siting fix below). `git status
      --short` immediately after a full `node scripts/check-no-credential-in-agent-surface.selftest.mjs` run
      shows only the pre-existing tracked-file edits, no planted artifact.
- [x] 2.8 Ensure every planted path is `.hel993-`-prefixed, gitignored, `finally`-guarded and cleaned idempotently
      at startup, including mode restoration.
      EVIDENCE (skeptic-final-1.md CR1, re-verified after fix): the first commit's case 3 left a
      `chmod`'d-000 stand-in `helio-mcp/` unrecoverable by `restoreMcpRootIfMoved()`'s
      `!existsSync(mcpRoot)` guard — reproduced the skeptic's exact crash state (real `helio-mcp/` parked
      at `helio-mcp-hel956-selftest-moved`, a stand-in `helio-mcp/` containing a chmod-000
      `.hel993-only-file.ts`; `git status --porcelain` = 70 lines). Added `removeHel993McpStandIn()`
      (chmods and removes the stand-in ONLY when `mcpMovedRoot` exists, so a real `helio-mcp/` can never be
      destroyed), called from both the startup-cleanup block and the `finally`, before
      `restoreMcpRootIfMoved()`. Re-ran the self-test against the reproduced crash state: it recovered to a
      clean tree (`git status --short` empty apart from this change's own tracked edits) and the gate
      printed the exact 82-file OK line at exit 0 afterward — no manual intervention needed.

## 3. Tests

- [x] 3.1 Mutation-verify each new case separately against the shipped script's source: disable in turn the
      surface-level read-failure error, the BFS read-failure error, the readdir-failure error, the access-error
      ordering, the entry-guard error, the `importGraph` dispatch and the `credentialProp` dispatch, recording for
      each that the matching case goes red and that no other case masks it. Capture the transcript as gate-chain isolation evidence.
- [x] 3.2 Run `npm run check:no-credential-leak`, `npm run check:no-credential-leak:selftest`, lint, format:check
      and typecheck; all green with a clean `git status`.
