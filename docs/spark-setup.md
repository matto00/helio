# Spark Cluster Setup (Local Development)

This guide covers running a self-hosted Apache Spark cluster locally using Docker Compose. This is used by the Helio backend for data processing jobs (see HEL-202 for the integration work that consumes this cluster).

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (v20+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2+, included with Docker Desktop)

Verify both are available:

```bash
docker --version
docker compose version
```

## Starting the cluster

From the repo root:

```bash
docker compose -f docker-compose.spark.yml up -d
```

This starts two containers:

| Service        | Role        | Port(s)                        |
| -------------- | ----------- | ------------------------------ |
| `spark-master` | Master node | `7077` (protocol), `8090` (UI) |
| `spark-worker` | Worker node | `8081` (UI)                    |

The master UI is remapped to `8090` to avoid collision with the Helio backend, which runs on `8080`.

## Verifying the cluster is healthy

1. Open the Spark master UI at [http://localhost:8090](http://localhost:8090).
2. Under **Workers**, confirm that one worker appears with status **ALIVE**.
3. Optionally check the worker UI directly at [http://localhost:8081](http://localhost:8081).

You can also check container health via:

```bash
docker compose -f docker-compose.spark.yml ps
```

Both services should show `healthy` once the start-up probes pass (allow ~30 seconds on first run).

## Stopping the cluster

```bash
docker compose -f docker-compose.spark.yml down
```

Add `-v` to also remove any named volumes (none are declared currently, so this is a no-op but harmless).

## Environment variables for the Helio backend

When running the Helio backend locally with Spark support, set:

| Variable           | Value                    | Notes                     |
| ------------------ | ------------------------ | ------------------------- |
| `SPARK_MASTER_URL` | `spark://localhost:7077` | Defaults to this if unset |

The default value in `application.conf` already points to `spark://localhost:7077`, so **no extra configuration is needed** for a plain local dev setup. Set `SPARK_MASTER_URL` explicitly only when overriding (e.g. pointing at a remote cluster or a different local port).

Add it to your `backend/.env` file:

```env
SPARK_MASTER_URL=spark://localhost:7077
```

## Troubleshooting

**Worker does not appear in master UI**

- Wait 30–60 seconds — the worker registration is asynchronous.
- Run `docker compose -f docker-compose.spark.yml logs spark-worker` to inspect worker startup logs.

**Port conflict on 8090 or 8081**

- Another process is using the port. Stop the conflicting service or change the host-side port mapping in `docker-compose.spark.yml` (left-hand side of `host:container`).

**Image pull failures**

- Ensure Docker has internet access and that `bitnami/spark:3.5` is reachable from Docker Hub.
