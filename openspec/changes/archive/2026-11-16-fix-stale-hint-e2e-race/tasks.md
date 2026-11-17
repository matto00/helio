## Standing Constraints

- [C1] No product code change (`frontend/src/**`, `frontend/index.html`, `frontend/package*.json`); test-only. A real product defect is escalated, not fixed.
- [C2] No retries and no larger timeouts; red-first under a deterministic forced repro.
- [C3] Playwright workers <= 2, `--trace retain-on-failure`, `timeout: 600000` on test Bash calls, nice -n 19.
- [C4] Do not touch specs owned by concurrent lanes (HEL-1705 pipelines live Output, HEL-1692 phone Table CSS).

## 1. Red first

- [x] 1.1 Throwaway probe under `.concertino/scratch/HEL-1623/` (design D3.1): force the hint clear to land after the seed on the UNMODIFIED test shape; record red over several repeats.

## 2. Fix

- [x] 2.1 Verify the landing document loads no code touching `helio.signedIn` (D1).
- [x] 2.2 Rewrite the stale-hint test per D1/D2.
- [x] 2.3 Sweep the rest of the spec per D4.

## 3. Proof

- [x] 3.1 D3.2: release-controlled hold around the new shape is green, with zero `/api/auth/me` requests between the seed `goto` and the second `goto("/")` (count recorded).
- [x] 3.2 D3.3: font stylesheet (a) hung until test end and (b) delayed 5 s; per-wait dependency probed; any dependent wait switched to `domcontentloaded`/`commit` (never a larger timeout); new test green under both.
- [x] 3.2b D3.4 (advisory): CI trace of run 43993159078 e2e (4) - landing `/` or `/home` at timeout; recorded.
- [x] 3.3 `--repeat-each=40` of the stale-hint test on current main deps (axios 1.21.1): 40/40.
- [x] 3.4 Whole spec file once, green.
- [x] 3.5 `proofs.md` in the change dir with commands, counts, outputs, and the hel813 CI-history scan (D5).
