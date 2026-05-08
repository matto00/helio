# Design — HEL-201: Self-hosted Spark Cluster Setup

## Docker Compose topology

```
docker-compose.spark.yml
├── spark-master   bitnami/spark:3.5  ports: 7077, 8080
└── spark-worker   bitnami/spark:3.5  depends_on: spark-master
```

- Single worker sufficient for local dev; scale with `--scale spark-worker=N` as needed.
- Both services share a `spark-network` bridge network.
- Master UI on 8080 (Spark default); kept separate from the Helio backend on 8080 — note the backend runs on 8080 too, so the Spark master UI port should be remapped to **8090** on the host to avoid collision.
- Worker UI on 8081 (host) → 8081 (container).

## Backend config

`application.conf` addition:

```hocon
spark {
  masterUrl = "spark://localhost:7077"
  masterUrl = ${?SPARK_MASTER_URL}
}
```

Loaded via Typesafe Config (already a transitive dependency via Pekko). No new library dependencies needed at this stage.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `SPARK_MASTER_URL` | `spark://localhost:7077` | Spark master address for job submission |

## File locations

| File | Purpose |
|---|---|
| `docker-compose.spark.yml` | Local cluster definition (repo root) |
| `backend/src/main/resources/application.conf` | Backend config (spark block added) |
| `docs/spark-setup.md` | Developer setup guide |
| `CLAUDE.md` | Env var documentation |
