# HEL-1707: After HEL-1652: pipeline-root add 500s if the pipeline is deleted mid-request; re-check grant inside privileged writes; NOBYPASSRLS regression tests and grant-spec coverage

## Description

Follow-ups from HEL-1652 (PR matto00/helio#1093, merged as afca73bc8). That PR lets editor grantees add and remove pipeline roots. The owner kept D1.

1. **Mid-request delete race:** `PipelineRootRepository.add` returns a 500 if the pipeline is deleted mid-request. The cause is the `.head` read of the pipeline name. This predates HEL-1652 and only happens in a race. Return a 404 instead.
2. **Grant revoked mid-request:** a grant revoked between the service's owner-or-editor check and the privileged transaction is not re-checked. Draft save and step writes have the same gap. Decide whether to re-check the grant inside the transaction for all three, and pin the result with a test.
3. **Missing regression tests:** add NOBYPASSRLS tests for cases the code already rejects but nothing covers:
   * an editor attaching another user's source as a root;
   * an editor naming another pipeline's root id on remove.
4. **Grant-spec coverage:** extend `PipelineRootWriteGrantsSpec` to UPDATE on `panels` and EXECUTE on `hel1629_lock_pipelines`.

## Acceptance Criteria (driver-stated, run constraints)

- (1) The mid-request delete race returns the same 404 an unknown pipeline gets; reproduced deterministically (a hook/latch between the access check and the read), red first, with a mutation.
- (2) Every privileged write an editor grantee can reach is enumerated with whether it re-checks the grant today. The in-transaction grant re-check (a revoked editor's write is refused, nothing written) is implemented for the agreed set; red first, with mutations. If the re-check would change any non-race outcome, or the enumeration finds paths beyond root add/remove, draft save and step writes, ESCALATE in Planning with options and a recommendation.
- (3) NOBYPASSRLS regression tests for: an editor attaching another user's source as a root; an editor naming another pipeline's root id on remove. Labelled as guards; each shown failable by mutation.
- (4) `PipelineRootWriteGrantsSpec` covers UPDATE on `panels` and EXECUTE on `hel1629_lock_pipelines`, after confirming both are real grants the code relies on. Labelled as guards.
- Full spec files run. A migration only if a grant is genuinely missing (latest V148).
