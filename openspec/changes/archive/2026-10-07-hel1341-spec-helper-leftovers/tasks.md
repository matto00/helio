## Standing Constraints

## 1. Backend (test code)

- [x] 1.1 Rename `assertNothingAcceptedBeforeSentinel` to `acceptedThroughSentinel` in AcceptRecordingListener and its 4 call sites; fix both scaladoc references; verify `grep -rn assertNothingAcceptedBeforeSentinel backend/` returns nothing
- [x] 1.2 Rename the DatasetWriteAutoRunEndToEndSpec real-clock test per design D2; body unchanged; verify by `git diff` showing only the name line changed

## 2. Docs

- [x] 2.1 Add the two inventory rows and correct the default-patience sentence in the archived HEL-1341 design.md per D3, after verifying line numbers and `whenReady` count on the live tree

## 3. Tests

- [x] 3.1 Run the 5 affected specs (`sbt "testOnly ..."` under `nice -n 19`) and PipelineShapeServiceSpec/SparkJobSubmitterSpec; all green; save the transcript as evidence
- [x] 3.2 Guard-is-failable check per D1: temporary stray connection in one caller turns it red; revert; green; save both transcripts as evidence
