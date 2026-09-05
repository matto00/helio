## Context

`PipelineRunServiceSpec` builds its `PipelineRunService` at line 134 without the `system: ActorSystem[_]` argument,
which defaults to `null` (`PipelineRunService.scala:59`). `urlFetchSeam` (`:90-92`) short-circuits on that null and
returns `Future.successful(Left("URL-backed source fetch is not configured"))` before reaching the `CsvUrlFetch.fetch`
or `ContentSourceSupport.fetchUrlWithLimit` branches at `:96-100`. That seam is the sole URL path in
`InProcessPipelineEngine` (`:513/541/565/597`), whose own constructor default (`:157`) is likewise a non-fetching
`Left`. So the URL string in these fixtures is inert: it is never parsed as a host, never resolved, never dialled.

Two sibling specs already encode the right convention for inert URL fixtures: `PipelineRunRoutesSpec.scala:199-200`
uses `https://pipeline-run-routes.test/ok` and `.../fail`, and `InProcessPipelineEngineSpec.scala:52-53` uses
`https://rest-engine.test/ok` and `.../fail`. Both name the spec in the host, so a reader can trace a literal back to
its owning fixture.

## Goals / Non-Goals

**Goals:**

- Make the three literals self-evidently non-network, so no future reader repeats the misreading that produced HEL-980.
- Preserve every existing assertion byte-for-byte in meaning.
- Follow the in-repo `.test`-TLD convention rather than inventing a fourth style.

**Non-Goals:**

- Standing up a local HTTP server. These tests discriminate on the seam being unwired; a real server destroys that.
- Touching production code, or the seam's behavior, which is correct.
- Proving network isolation empirically via an egress-blocked run. Disproportionate for a literal swap, and the
  deterministic path read already establishes it.

## Decisions

**D1 — Host name: `pipeline-run-service.test`.** Mirrors the sibling convention of naming the host after the owning
spec (`pipeline-run-routes.test`, `rest-engine.test`). `.test` is reserved by RFC 2606 and can never resolve, so the
literal is inert by specification, not merely by the current seam wiring. Alternative considered: `localhost` — 
rejected, because it *would* resolve and would misleadingly imply a server is expected to be listening.

**D2 — Change all three literals, not the two the original ticket named.** The ticket names lines 972 and 1014
(`seedTextUrlDs`); line 939 (`seedCsvUrlDs`) carries the identical `example.com` literal for the identical reason.
Leaving one behind would preserve exactly the misreading hazard this change exists to remove, and would look like an
oversight to the next reader. This is a strict narrowing of blast radius within one file, not a scope expansion.

**D3 — Keep the paths (`/data.csv`, `/notes.txt`).** They carry the source-kind signal that makes each test readable
(`seedCsvUrlDs` vs `seedTextUrlDs`); only the host was misleading.

**D4 — No new comment explaining that the URL is inert.** The surrounding comments at lines 934-938 and 966-971
already state the seam is unwired, at length. A `.test` host plus those comments is sufficient; a third restatement
would be noise.

## Risks / Trade-offs

- **Risk: an assertion silently depends on the host string.** Low but checkable — the assertions are on `Left`,
  `ServiceError.UnprocessableEntity`, `status`, and `errorLog shouldBe Some("Pipeline execution failed")`, none of
  which embed a URL. The executor verifies by running the spec, and the diff is small enough to read exhaustively.
- **Trade-off: this closes the misreading hazard, not a real defect.** Accepted deliberately by the owner: the
  misreading cost has already been paid three times, and the fix is three string edits.
- **Risk: the change looks trivial and gets rubber-stamped, repeating HEL-881's failure mode in miniature.** Mitigated
  by the PR body carrying the refutation and the negative grep sweep, so the durable artifact is the analysis rather
  than the diff.

## Planner Notes

Self-approved: the host name (D1), extending to the third literal (D2), and omitting a new explanatory comment (D4).
None introduce a dependency, alter an API, or expand scope beyond the single test file the ticket already targets.
