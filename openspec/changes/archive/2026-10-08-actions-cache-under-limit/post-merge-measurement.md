# HEL-1299 post-merge measurement (driver-run)

Repo: matto00/helio. Run after the merge; record results on the ticket.

## AC1: usage <= 6 GB, at least 24 h after merge (and after one janitor run)

    gh api repos/matto00/helio/actions/cache/usage --jq '.active_caches_size_in_bytes, .active_caches_count'
    gh api --paginate 'repos/matto00/helio/actions/caches?per_page=100' --jq '.actions_caches[]|[.key,.ref,.size_in_bytes]|@tsv' \
      | awk -F'\t' '{k=$1; sub(/-[0-9a-f]{16,}.*/,"",k); sub(/^(codeql-overlay-base-database)-.*-(javascript|python|actions)-.*/,"codeql-\\2",k); s[k]+=$3; n[k]++} END{for(k in s) printf "%s\t%d\t%.0f MB\n",k,n[k],s[k]/1e6}' | sort

Expect <= 6 GB (projection ~2.1 GB). Baseline before: 11,664,011,910 bytes, 25 entries (evidence/cache-baseline-2026-10-08.tsv). Dry-run preview of the first
janitor run: janitor-dry-run-2026-10-08.txt (14 entries, 4.66 GB).

## AC2: no tag-scoped entries after the next `v*` deploy

    gh api --paginate 'repos/matto00/helio/actions/caches?per_page=100' --jq '.actions_caches[]|select(.ref|startswith("refs/tags/"))|[.key,.ref,.size_in_bytes]|@tsv'

Expect no output after the next v* CD run (CD Frontend no longer caches npm; CD Backend never cached).

## AC4: CodeQL languages unchanged

    gh api repos/matto00/helio/code-scanning/default-setup --jq '.languages, .state, .query_suite'

Expect `actions`, `javascript-typescript`, `python` still present (baseline 2026-10-08: same three, weekly schedule, default suite).

## D5: closed-PR cleanup

After the next PR closes (N = its number):

    gh api --paginate 'repos/matto00/helio/actions/caches?ref=refs/pull/N/merge&per_page=100' --jq '.total_count'      # expect 0
    gh run list --workflow "Cache Cleanup (PR close)" --limit 3
    gh api repos/matto00/helio/actions/cache/usage --jq .active_caches_count   # main entries not dropped by it (compare with the pre-close listing)

## Janitor

    gh workflow run cache-janitor.yml -f dry_run=true     # dispatch defaults to dry run; read the log
    gh run list --workflow "Cache Janitor" --limit 5      # scheduled / workflow_run runs delete for real

## AC5: CI wall-clock not worse, medians over 5 green main runs after merge

    for r in $(gh run list --branch main --workflow CI --status success --limit 5 --json databaseId --jq '.[].databaseId'); do
      gh api repos/matto00/helio/actions/runs/$r/jobs --paginate --jq '.jobs[]|select(.name|test("^(backend|e2e)"))|[.name,((.completed_at|fromdate)-(.started_at|fromdate))]|@tsv'
    done

Take the median of the slowest backend leg and the slowest e2e leg per run, and the median of the 5 runs, per job family. Compare with HEL-1287/1288's post-merge numbers
(archived changes): backend job median target <= 5.5 min (warm slowest-leg median <= 5.0 min, 2026-10-05-halve-backend-ci-time design/D8); e2e slowest-leg median ~6.9 min
accepted by owner ruling C11 (target <= 7 min, 2026-10-06-halve-e2e-ci-job-time). Pre-change reference from this lane: backend "Compile and test" step on 6 recent main
runs ranged 138..233 s per leg (see ci-evidence-pr860.md). Also confirm backend-compile cache hits: exact or restore-key hit lines in the backend legs' "Restore backend
compile output" step, and the main shard-0 "Prune sbt CAS before save" log line (`cas:`/`ac:` counts) with the saved entry size from the AC1 listing.
