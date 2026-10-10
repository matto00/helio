#!/usr/bin/env bash
# HEL-1435: (re)create the local measurement PostgreSQL 16 container on the named volume, in one of the resource
# profiles. Local Docker only; bound to 127.0.0.1; every object is namespaced hel1435. Usage:
#   hel1435-container.sh <desktop|prod-io-strict|prod-io-base|prod-noio> [shared_buffers]
# Profiles (sources/assumptions: measurements.md section 2):
#   desktop         --cpus=4   --memory=4g   no IO limit (continuity with HEL-1284's host numbers)
#   prod-io-strict  --cpus=0.5 --memory=1.7g write/read 4800 kB/s and 300 IOPS (documented per-GB PD-SSD model x 10 GB)
#   prod-io-base    --cpus=0.5 --memory=1.7g 240 MB/s and 6000 IOPS (ASSUMED PD-SSD baseline, bracket)
#   prod-noio       --cpus=0.5 --memory=1.7g no IO limit (isolates the CPU/memory effect)
# Env: DIRECT=1 (see below); CPUS overrides --cpus (e.g. CPUS=1.0 for the shared-core sensitivity bracket).
set -euo pipefail
profile="${1:?profile}"; sb="${2:-}"
name=hel1435-pg; volume=hel1435-pgdata; port=55435; disk=/dev/nvme0n1
case "$profile" in
  desktop)        cpus=4;   mem=4g;   io=();                                             sb="${sb:-128MB}" ;;
  prod-io-strict) cpus=0.5; mem=1.7g; io=(--device-write-bps $disk:4800kb --device-read-bps $disk:4800kb --device-write-iops $disk:300 --device-read-iops $disk:300); sb="${sb:-128MB}" ;;
  prod-io-base)   cpus=0.5; mem=1.7g; io=(--device-write-bps $disk:240mb --device-read-bps $disk:240mb --device-write-iops $disk:6000 --device-read-iops $disk:6000); sb="${sb:-128MB}" ;;
  prod-noio)      cpus=0.5; mem=1.7g; io=();                                             sb="${sb:-128MB}" ;;
  *) echo "unknown profile $profile" >&2; exit 2 ;;
esac
cpus="${CPUS:-$cpus}"
# DIRECT=1: PostgreSQL bypasses the OS page cache for data files (debug_io_direct=data), so every shared_buffers
# miss is a real, throttled device read -- the cold-cache extreme of a 1.7 GB host (default shared_buffers then
# 600MB, about a third of the 1.7 GB RAM). Without it, reads served from the host's page cache are never throttled.
direct=(); if [ "${DIRECT:-0}" = 1 ]; then direct=(-c debug_io_direct=data); [ -n "${2:-}" ] || sb=600MB; fi
docker volume create "$volume" >/dev/null
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" --cpus="$cpus" --memory="$mem" --memory-swap="$mem" --shm-size=1g "${io[@]}" \
  -p 127.0.0.1:$port:5432 -v "$volume":/var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=postgres \
  postgres:16 \
  -c shared_buffers="$sb" -c shared_preload_libraries=auto_explain \
  -c auto_explain.log_min_duration=-1 -c auto_explain.log_analyze=on -c auto_explain.log_buffers=on \
  -c auto_explain.log_timing=on -c auto_explain.log_nested_statements=on -c auto_explain.log_wal=on \
  "${direct[@]}" -c log_temp_files=0 -c log_line_prefix='%m [%p] %a ' -c max_connections=30 >/dev/null
# Crash recovery after a killed predecessor can take minutes on the throttled profiles: wait for a real query to work.
ready=0
for _ in $(seq 1 900); do
  if docker exec "$name" psql -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { echo "container did not become ready in 15 minutes" >&2; exit 1; }
echo "profile=$profile cpus=$cpus mem=$mem shared_buffers=$sb io=${io[*]:-none}"
