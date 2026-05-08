# Proposal — HEL-201: Self-hosted Spark Cluster Setup

## Problem

The Spark Integration epic (HEL-143) requires a self-hosted Apache Spark cluster as the pipeline execution backend. Before job submission logic (HEL-202) can be implemented, the cluster must be reachable from the Helio backend, and developers need a repeatable way to run it locally.

## Proposed Solution

Deliver three codebase artifacts that establish the Spark infrastructure foundation:

1. **`docker-compose.spark.yml`** — A Docker Compose file defining a Spark master and one worker node using the official Bitnami Spark image. Developers bring up the local cluster with a single command. Ports exposed: 7077 (Spark master), 8080 (Spark master UI), 8081 (worker UI).

2. **Backend configuration skeleton** — A `spark` block in `backend/src/main/resources/application.conf` with `masterUrl` driven by `SPARK_MASTER_URL` env var (default `spark://localhost:7077`). This is the connection point HEL-202 will use for job submission.

3. **`docs/spark-setup.md`** — Step-by-step guide covering prerequisites (Docker), how to start/stop the cluster, how to verify it's healthy, and what env vars to set for local development.

4. **`CLAUDE.md` update** — Document `SPARK_MASTER_URL` in the environment variables table.

## Out of scope

- Actual Spark job submission (HEL-202)
- Production cluster provisioning (ops concern outside this repo)
- Spark dependencies in the Scala build (added in HEL-202)
