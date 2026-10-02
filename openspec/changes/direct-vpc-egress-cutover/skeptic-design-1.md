## Skeptic Report - design gate (round 1, skeptic-design-1.md)

### What I verified (read-only gcloud, --help, repo)
- Claim 1 (subnet): auto-mode default network (autoCreateSubnetworks=True); us-west1 subnet 10.138.0.0/20; all routes are auto 10.128.0.0/9 /20s, 10.9.0.0/28 (connector), 10.8.0.0/24 peering route (accepted), reserved range 10.8.0.0/20. 10.10.0.0/26 overlaps none and is outside 10.128.0.0/9. CONFIRMED. /26 minimum per premise evidence.
- Claim 2 (--no-traffic pins): `gcloud run services update --help` states --no-traffic assigns LATEST traffic to the specific revision bound to LATEST, and "LATEST revision will not receive traffic on future deployments" until update-traffic is run. Live service spec.traffic is latestRevision:true 100% + stale tag cutover-verify (00055). CONFIRMED; --to-latest is right (update-traffic --help lists --to-latest).
- Claim 4 (CD): cd-backend.yml flags are only --update-env-vars/--update-secrets/--max-instances, no network flags. Conclusion plausible and consistent with live rev 00083 (CD-made) carrying the connector. CONFIRMED (residual post-cutover describe owned by driver).
- Claim 5: update changes only named fields; deploy-backend.sh uses --set-env-vars/--set-secrets replace (lines 95-96), so update is the safer mechanism. CONFIRMED.
- Claim 6: spec delta restates the whole requirement (all bullets/scenarios kept, connector scenario reworded, one scenario added). Correct MODIFIED form. Nit: the private-networking scenario says SHALL NOT find any remaining reference to a Serverless VPC Access connector, but the proposal/tasks say infra/README.md keeps "intentional rollback mentions" (task 2.2) - contradictory; resolve one way.

### Verdict: REFUTE

### Change Requests
1. Design Decision 5 (rollback) is incoherent. After `update-traffic --to-revisions=<old>=100`, traffic is pinned. The follow-up `services update --vpc-connector=... --clear-network` (no --no-traffic) creates a new revision that, per the same gcloud semantics cited in Decision 4, will NOT receive traffic while pinned; the service is not restored to latest-routing. The sequence must end with `gcloud run services update-traffic helio-backend --to-latest` (after the fix-forward revision is verified), and say so in the runbook. Also state explicitly that the instant rollback pins by revision name (the connector revision, helio-backend-00083-7cz) and that any CD deploy while pinned gets no traffic.
2. Resolve the spec-vs-task contradiction: either the spec scenario permits connector mentions in a rollback context (reword "SHALL NOT find ... as the primary connectivity method"), or task 2.2 must keep zero connector mentions in infra/README.md.
3. (Minor, make explicit in tasks) Verification of the "authenticated DB call" on the tag URL: state how (session cookie is Secure/cross-site; use a PAT/Bearer via curl to the tag URL) so the step is executable by the driver.

### Non-blocking notes
- Precondition check that the tagged revision is the latest created revision is good; also add `describe --format` check that traffic shows latestRevision after --to-latest.
- Stale cutover-verify tag noted and left; fine.
