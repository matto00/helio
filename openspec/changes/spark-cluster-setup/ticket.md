# HEL-201 — Self-hosted Spark cluster setup

## Title
Self-hosted Spark cluster setup

## Description
Infrastructure: provision and configure a self-hosted Apache Spark cluster. Define cluster topology (master/worker), resource allocation, and network access from the Helio backend. Document setup and configuration.

## Scoped Delivery (agreed with user)

1. Add `docker-compose.spark.yml` — Spark master + at least one worker node.
2. Add skeleton backend connection config: new env vars for Spark master URL etc., documented in CLAUDE.md.
3. Include setup documentation in `docs/spark-setup.md`.
4. Note external setup steps clearly (no Spark binary download needed — Docker image handles it).

## Acceptance Criteria
- `docker-compose.spark.yml` defines Spark master + worker, health checks, port mappings (Spark UI 8082, master 7077).
- Backend `application.conf` has a `spark` config block with `masterUrl`, env var `SPARK_MASTER_URL` defaulting to `spark://localhost:7077`.
- `CLAUDE.md` documents the new environment variables.
- `docs/spark-setup.md` provides step-by-step local cluster bring-up guide.
- No new Scala compilation errors.
- No existing tests broken.
