# HEL-749: Migrate Cloud Run→Cloud SQL from the connector library to Private IP + Serverless VPC Access

## Description

Structural follow-up to the recurring Cloud SQL connection-storm incidents (HEL-696, and today's recurrence). The backend currently reaches Cloud SQL over its public IP via the `com.google.cloud.sql:postgres-socket-factory` connector library (`DATABASE_URL=jdbc:postgresql:///helio?cloudSqlInstance=...&socketFactory=...`), which requires a TLS handshake plus an ephemeral-cert fetch via the Cloud SQL Admin API on every new physical connection. That handshake is the actual failure point in both incidents.

**Proposal:** move to Private IP + a Serverless VPC Access connector — Google's recommended setup for production Cloud Run→Cloud SQL traffic. This removes the connector library's cert-refresh/handshake dependency from the request path entirely (direct network connection over the VPC instead), which should eliminate this whole failure class rather than just tuning around it.

## Scope

* Provision a Serverless VPC Access connector in the same region.
* Enable Private IP on the `helio-db` Cloud SQL instance (requires it join the VPC — check for any downtime window Cloud SQL needs for this).
* Update `DATABASE_URL`/connection config to use the private IP directly instead of the socketFactory form; update `infra/deploy-backend.sh` and Cloud Run service annotations accordingly (remove `run.googleapis.com/cloudsql-instances`, add VPC connector annotation).
* Verify RLS/`helio_privileged` role behavior is unaffected (connection setup mechanics change, application-level auth does not).

## Not urgent-hotfix scope

This is a genuine infrastructure/networking migration with real cutover risk (a botched change could cut off DB access entirely), so this should NOT be delivered through the standard autonomous code-review pipeline alone; plan for a deliberate, checkpointed execution with a rollback path, not a blind automated cycle.

Filed 2026-08-19 following a live production Cloud SQL connectivity incident.
