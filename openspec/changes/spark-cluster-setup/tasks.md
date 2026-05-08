# Tasks — HEL-201: Self-hosted Spark Cluster Setup

## T1 — Add docker-compose.spark.yml
Create `docker-compose.spark.yml` at the repo root with:
- `spark-master` service: bitnami/spark:3.5, ports 7077 (master) and 8090:8080 (UI, remapped to avoid collision with Helio backend on 8080)
- `spark-worker` service: bitnami/spark:3.5, depends_on spark-master, port 8081 (worker UI)
- Shared `spark-network` bridge network
- Health checks on both services

## T2 — Add spark config block to application.conf
In `backend/src/main/resources/application.conf`, add a `spark` block:
```hocon
spark {
  masterUrl = "spark://localhost:7077"
  masterUrl = ${?SPARK_MASTER_URL}
}
```

## T3 — Write docs/spark-setup.md
Create `docs/spark-setup.md` covering:
- Prerequisites (Docker + Docker Compose)
- Starting the cluster: `docker compose -f docker-compose.spark.yml up -d`
- Verifying health: Spark master UI at http://localhost:8090
- Stopping: `docker compose -f docker-compose.spark.yml down`
- Environment variables to set for local Helio backend development

## T4 — Update CLAUDE.md env vars table
Add `SPARK_MASTER_URL` row to the backend environment variables table in `CLAUDE.md`.

## Verification gates
- `docker compose -f docker-compose.spark.yml up -d` starts without errors
- Spark master UI reachable at http://localhost:8090
- `sbt compile` passes with no errors
- `sbt test` passes with no regressions
