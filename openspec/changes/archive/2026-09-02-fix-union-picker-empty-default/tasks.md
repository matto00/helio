## 1. RED — reproduce the bug

- [ ] 1.1 Write a backend test that POSTs `type: "union"` with `config.otherDataSourceId` set to
      the empty string exactly as the frontend picker's `defaultConfigFor("union")` seeds it (not
      a hand-picked valid id), against `unionCheckF`'s current unguarded state, and confirm it
      currently returns `404 Not Found` (RED). Add the equivalent PATCH-to-empty case.
- [ ] 1.2 Capture the RED test run output as evidence before making any fix change.

## 2. Backend fix

- [ ] 2.1 Guard `unionCheckF` in `PipelineService.addStep` with
      `case uc: UnionConfig if uc.otherDataSourceId.nonEmpty =>`, mirroring `lookupCheckF`'s
      existing shape and comment style exactly (PipelineService.scala:867-874).
- [ ] 2.2 Apply the identical guard to `unionCheckF` in `PipelineService.updateStep`
      (PipelineService.scala:~1101-1108).
- [ ] 2.3 Re-run the RED tests from 1.1 — confirm GREEN.
- [ ] 2.4 Re-run the full existing HEL-384 union ACL test suite (cross-user 404, own-source 201)
      unchanged — confirm still GREEN, no regression to the security boundary.

## 3. Spec + evidence

- [ ] 3.1 Confirm `openspec/changes/fix-union-picker-empty-default/specs/pipeline-union-op/spec.md`
      delta matches the shipped backend behavior exactly (MODIFIED requirement + 5 scenarios).
- [ ] 3.2 Run `npm run lint`, `npm run typecheck` (frontend — no changes expected, sanity check
      only), and Scala code-quality / `sbt test` for touched backend files.
- [ ] 3.3 Live browser verification via Playwright MCP: start dev frontend + backend against the
      throwaway local Postgres, open a pipeline, click "+ Add transformation step" → union, select
      a second data source, confirm no 404 and the step persists across reload.

## 4. Report

- [ ] 4.1 Document in the final report: root cause, RED output, GREEN output, live browser
      verification steps, and the `joinCheckF` follow-up finding (file:line) for a spinoff ticket.
