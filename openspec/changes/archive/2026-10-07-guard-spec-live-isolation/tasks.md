## Standing Constraints

- [C1] No product code, `playwright.config.ts` or `.github/workflows/**` edits.
- [C2] No assertion, expectation, count, threshold, timeout, retry, skip or quarantine change in any spec; allowed: the
  D1/D2 guard reorder, helper migration (import, deleted local copy, call-site args), `expect(201)`/email log line.
- [C3] `isolateLivePage` is never followed by `reload`/`evaluate`/localStorage before the next app-origin `goto`.
- [C4] Local Playwright: `nice -n 19`, `--workers 2` max, headless, this worktree's ports; no shared Playwright MCP
  browser or shared `/tmp` cookie jar; record every throwaway email; delete nothing; never pkill/pgrep/killall.

### Tests

- [x] 1.1 Capture main's per-view guard summary lines for both guards (D3) into `verification.md`.
- [x] 1.2 Add `e2e/support/auth.ts` per D4; lint/format/`check:e2e-types` pass.
- [x] 1.3 Reorder `focus-presence-guard.spec.ts` per D1 and migrate it to the shared helper.
- [x] 1.4 Apply D2 to `state-surface-contrast-guard.spec.ts` (explicit isolate + comment; shared `registerUser`).
- [x] 1.5 Migrate the remaining 30 local copies per D4; record per-file mapping (isolate yes/no, extras) in
  `verification.md`; state the C2 check used on `git diff`.
- [x] 1.6 Add the `e2e/README.md` usage note (D5).
- [x] 1.7 Branch guard summary lines equal main's (D3); diff recorded in `verification.md`.
- [x] 1.8 Both guards `--repeat-each 10 --workers 2` under `nice -n 19`; result + log paths in `verification.md`.
- [x] 1.9 Every default-collected migrated spec once at `--workers 2`; record collected/passed/skipped per file (0 collected
  or all-skipped is never a pass); failures re-run on base to classify. Quarantined/regression files: D6(c) labelling.
- [x] 1.10 Throwaway emails recorded; lint, format check, typecheck; commit passes hooks without `-n`.
