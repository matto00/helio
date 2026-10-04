## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed head 5a0e83f348f40d46ddaf1bb480a819b4944b20e5 (base 7138d4e9, resolved live).

### What I verified (with evidence)
- Diff read in full for backend routes/gate/CsvLimits and the frontend 413 path. Spawn-cwd guard READY.
- Servers started via start-servers.sh (assert-phase PASS); bound pids' cwd verified (readlink /proc) to this worktree; stopped by exact pid afterwards.
- Live curl against the running backend (CSRF header X-Helio-Requested-With):
  - GET /api/data-sources/csv-limits -> {maxBytes:15728640,maxRows:50000,maxCells:300000}.
  - infer, file of exactly 15 MiB (15728640 B) -> 200; 15 MiB + 1 byte -> 413 with the limits message. Edge is correct.
  - 25 MiB pdf create -> 413 (was 500 on main by design); 15 MiB text -> 413 "File exceeds the maximum allowed size of 10485760 bytes".
  - Truncated multipart and non-multipart body on infer -> 400 "request content was malformed" (not mis-mapped to 413).
- Live UI (AddSourceModal, CSV, 60,000-row file, Preview schema), dark AND light: server 413 message shown inline, no Retry affordance, layout/tokens consistent with sibling modal states. Evidence: ref=/home/matt/Development/helio/.concertino/runs/HEL-1221/evidence/skeptic-413-dark.png and skeptic-413-light.png. Only console error is the expected 413 network entry.
- Re-ran myself: sbt testOnly CsvUploadLimitsRoutesSpec + CsvLimitsSpec (real-socket route tests, gate/429/Retry-After/release, row/cell/byte caps, 8 MiB-edge, 12 MiB accept): 29 passed, 0 failed (stack traces in output are logged expected-failure cases). sbt --client shutdown run separately. Full-suite/lint/frontend results I took from the evaluator's pasted counts (5557 passed; npm suites), not re-run.
- AC trace: Green (within caps succeeds; over caps 413 with clear message) - verified live above. 413 shown clearly with no futile Retry - verified live (AddSourceModal) and by frontend tests (FirstRunDropZone, AddSourceModal, csvSourceCreate) per diff. Both themes - done. AC narrowing from "up to 50 MiB" to 15 MiB/50k/300k is supported by committed measurements.md (50 MiB N=2 wide run: 43 full GCs, 503s at 768m; 300k cells passes N=2 at 512m) and the binding owner ruling; design.md/proposal.md/spec state the shipped caps.
- Single source of truth: CsvLimits owns bytes/rows/cells; entity limit derived (maxBytes + 1 MiB); frontend hard-coded constant removed, limits fetched from the endpoint.

### Verdict: CONFIRM

### Judgment on the evaluator's non-blocking notes
- Wrong wording / over-broad catch (CsvUploadDirectives.scala:51-53): confirmed live that a >21 MiB pdf gets "CSV is too large..." text. This is a cosmetic inaccuracy on a path that was a 500 before, reachable only by API or the PDF form's generic handler; not an AC item. Malformed/truncated multipart does NOT reach it in practice (live: 400). Non-blocking, but cheap to tighten (map only EntityStreamSizeException; per-type message).
- text/pdf buffering up to ~21 MiB (text cap 10 MiB): the per-type cap still rejects with 413 and its own message (live), memory is bounded by the 2-permit gate (about 42 MiB worst case), and the shared route cannot know the type before reading the file part. Before the change the effective limit was Pekko's 8 MiB, which silently under-served text/pdf/image up to their caps with a 500. I do not read "effective limit at or below their own caps" as an AC or a committed constraint (it appears only in the brief; C1-C5 do not contain it). Non-blocking; if the owner wants it strict, it needs a header-sniff design, which is out of scope.
- Mislabeled pdf test, 429 generic copy in AddSourceModal, un-indented csvUpload bodies: agree, polish only.

### Non-blocking notes
- Red-first on main (8-50 MiB upload and near-8-MiB upload -> 500) is ticked in tasks.md 1.1 but I found no captured red output in the committed artifacts or run evidence dir; premise-validation.md and measurements.md (defect 2) corroborate the mechanism. The PR body must carry the red evidence and state the AC narrowing (C4); I could not verify the PR body, which does not exist yet.
- Recommended follow-ups: narrow the exception mapping; per-type 413 message; rename/strengthen the pdf test.
