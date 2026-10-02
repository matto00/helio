## Skeptic Report - design gate (round 2, skeptic-design-2.md)

### What I verified
- CR1 (rollback): design.md Decision 5 now ends with fix-forward `services update --vpc-connector=... --clear-network --vpc-egress=... --no-traffic --tag=rollback-verify`, verify, then `update-traffic --to-latest` and a describe check for latestRevision: true; states revision-name pinning and that CD deploys while pinned get no traffic. Resolved and executable in order.
- New-risk check: `--vpc-connector` + `--clear-network` in one `services update`: gcloud `run services update --help` (read-only) lists them in separate, non-exclusive groups (--clear-network is in the network group only; --vpc-connector is standalone). Forward cutover's `--network --subnet --clear-vpc-connector` also valid per the same help (--clear-vpc-connector standalone, network/subnet group). --vpc-egress requires direct egress or a connector, satisfied in both directions.
- Live state unchanged: latestCreatedRevision 00083-7cz, traffic latestRevision 100% plus stale cutover-verify tag.
- CR2: spec scenario now permits rollback/history-context connector mentions; task 2.2 verify matches (only rollback/history mentions). Contradiction resolved.
- CR3: task 2.1 specifies PAT as `Authorization: Bearer` against `GET /api/dashboards` on the tag URL, explains why the cookie is unusable. Resolved. 2.1 also includes `--to-latest` and the describe check.

### Verdict: CONFIRM

### Non-blocking notes
- In the rollback fix-forward the new revision is created from the latest template, which is the direct-egress one; the runbook should note --vpc-connector on a template that carries network-interfaces relies on --clear-network in the same command (as written).
- Runbook should say the instant-rollback step is moot if --to-latest has not yet been run (traffic is still pinned to 00083).
