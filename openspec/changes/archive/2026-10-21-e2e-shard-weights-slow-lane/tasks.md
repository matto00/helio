## Standing Constraints

- [C1] Slow lane trigger is weekly cron plus workflow_dispatch (owner ruling 2026-10-21); never nightly, never per-PR
  except the paths filter on its own workflow file.
- [C2] `e2e/shard-weights.tsv` is only ever written by `node scripts/e2e-shard.mjs weights ...`; never hand-edited.
- [C3] Never read, cat, grep or print any `.env` file (CON-261).
- [C4] Local Playwright: `flock -w 3600 <e2e.lock>`, `nice -n 19`, at most 2 workers; frontend jest with
  `HELIO_JEST_MAX_WORKERS=2`; load gate (1-min load > 10 -> sleep 60, recheck, up to 30 min). No kill/pkill/pgrep/killall.

### CI config

## 1. Shard weights

- [x] 1.1 Record `node scripts/e2e-shard.mjs plan 4` (before) to scratch; verify the defaulted list includes hel1681/hel1683
- [x] 1.2 Download `playwright-json-shard-*` for recent main push runs to scratch; verify each accepted/rejected by the validator
- [x] 1.3 Regenerate `e2e/shard-weights.tsv` from the 5 most recent accepted runs (D1); verify header `# Runs:` lists them
- [x] 1.4 Re-run `plan 4` (after); verify predicted max-min leg load shrinks and `defaulted` lists only unmeasured specs

## 2. Slow lane

- [x] 2.1 Add `.github/workflows/e2e-slow.yml` per design D3/D4; verify it parses (js-yaml) and triggers are exactly D3's
- [x] 2.2 Add the skipped-test guard step; verify it fails on a results.json with skipped > 0 and passes on a clean one
- [x] 2.3 Update comments and the skip reason in `e2e/support/hel1582Phone.ts` and `e2e/hel1582-sweep-{390,768}.spec.ts` (D6); verify `git diff` touches only comment/string lines
- [x] 2.4 Add a comment-only cross-reference in `ci.yml`'s e2e job to `e2e-slow.yml`; verify `git diff ci.yml` is comment-only
- [x] 2.5 Document the slow lane in `e2e/README.md`; verify the README names the workflow, trigger and env var

### Tests

## 3. Verification

- [x] 3.1 Run `npm run check:e2e-shard:selftest`, `check:ci-complete-needs`, `check:ci-sbt-guard`, lint/format, and grep `e2e-slow.yml` for pgrep/pkill/killall/kill (zero hits); verify all exit 0
- [x] 3.2 Run the full e2e suite locally under the e2e lock (C4); verify pass, recording any known flake
- [x] 3.3 Run the two sweep files locally with `HELIO_E2E_SLOW=1` under the lock; verify MAXIMAL tests ran (not skipped)
- [x] 3.4 Write `files-modified.md` listing every path explicitly (CON-260)

## 4. Post-merge evidence (orchestrator, not executor)

- [ ] 4.1 `gh workflow run e2e-slow.yml --ref main`; verify green and that MAXIMAL 390/768 ran (log lines), record run id
- [ ] 4.2 Per D7: whole-leg times of the first >= 3 all-green post-merge main push runs; pass iff median spread <= 120 s (report max); else hand back as not met
