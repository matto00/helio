## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file; no env-dumping commands; only scripts may read scripts/concertino/.concertino.env, never print it.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs; stop servers with stop-servers.sh; test residue deleted by exact id.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull in shards that fit; never background past the tool timeout.
- [C12] Red first with mutations; full spec files; commit the red run before implementation code.
- [C13] Scratch in .concertino/scratch/HEL-1779/; follow-up references in .concertino/runs/HEL-1779/evidence/.
- [C14] Lane-private DB helio_hel1779 if servers are needed; ANTHROPIC_API_KEY exported empty; no live model call.

### Tests (red first)

- [x] 1.1 Proposal tool schema spec: propose_pipeline/propose_combined Output kind enum contains insight (red)
- [x] 1.2 Patch-set preview rejects an insight create whose reads.outputs is not a stored non-insight Output of the pipeline (red)
- [x] 1.2b Patch-set preview rejects an insight output UPDATE with bad reads.outputs (red); same-set delete + reads case
- [x] 1.3 OutputKindDriftSpec positive assistant checks (enum == canonical, KeysDoc documents insight keys/values) (red)
- [x] 1.4 Record the red run in .concertino/scratch/HEL-1779/red.txt and the evidence dir; commit tests + red record

### Backend

- [x] 2.1 Derive PipelineProposalOutputSchema kind enum from OutputKind.all (D1)
- [x] 2.2 KeysDoc iterates KnownKeys; delete DocumentedKnownKeys; insight sentence from constants; fix shared-keys sentence (D2)
- [x] 2.3 InsightNewPipelineReadsDoc / InsightExistingPipelineReadsDoc appended per write path; refinement check (D3)
- [x] 2.4 InsightReadsCheck in resolveOutputCreate; InsightReadsCheck + validateConfig in resolveOutputUpdate; map net of same-set deletes (D4)
- [x] 2.5 AssistantSystemPrompt insight bullet (D6)
- [x] 2.6 Reword the stale OutputConfigValidation comment

### Frontend

- [x] 3.1 Verify the assistant proposal review UI shows an insight Output; fix with a test only if it does not (D8)

### Tests (green + guards)

- [x] 4.1 Patch-set insight create previews and applies; stored kind/config asserted
- [x] 4.2 Pipeline proposal with insight (refresh manual, no reads) applies, zero rows after the apply run; non-empty reads.outputs is 400
- [x] 4.3 Patch-set no-render: REAL InsightRenderService as insightTrigger over a failing fake model (never NoOp); zero calls/rows; recorded red mutation (D5)
- [x] 4.3b Record fieldMapping behaviour for insight and the refinement-path finding in evidence
- [x] 4.4 Mutations for D7 recorded in drift-mutations.md; each red, then restored green
- [x] 4.4b Apply skeptic-design-2 non-blocking notes 1-5 (known broken specs incl. DurationFormatSeamSpec ordering; set-level delete pass; scan only the insight: segment; 4.2 is a GUARD with an on_run mutation; record the double-update edge)
- [x] 4.5 Full affected spec files + sbt testFull shards, lint/format gates green
