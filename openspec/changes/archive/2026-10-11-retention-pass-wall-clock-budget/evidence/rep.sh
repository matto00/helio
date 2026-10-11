#!/usr/bin/env bash
# usage: rep.sh <label> <retention on|off> <ticks>
# Record of the HEL-1477 measurement commands: reset the scratch DB from the pristine template clone, then run one loop.
# Needs the hel1477-pg container (backend/scripts/perf/hel1477-container.sh) seeded per measurements.md; paths are repo-relative.
D="$(cd "$(dirname "$0")" && pwd)"
W="$(git -C "$D" rev-parse --show-toplevel)"
E="$D"
P="psql -X -w -h 127.0.0.1 -p 55477 -U postgres"
label=$1; ret=$2; ticks=$3
$P -d postgres -qc 'DROP DATABASE IF EXISTS helio_hel1477_scratch WITH (FORCE)' && $P -d postgres -qc 'CREATE DATABASE helio_hel1477_scratch TEMPLATE hel1477_pristine' || exit 1
grep MemAvailable /proc/meminfo > "$E/loop-$label.log"
"$D/m.sh" loop jdbc:postgresql://127.0.0.1:55477/helio_hel1477_scratch "$label" "$ret" 30000 "$ticks" 5000 20s 2>&1 | grep -E '@@|error|Exception' >> "$E/loop-$label.log"
echo done >> "$E/loop-$label.log"
