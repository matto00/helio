#!/usr/bin/env bash
# Probe harness: named psql sessions over FIFOs against the scratch cluster (never the shared dev DB).
# A session ends when its fifo writer closes (EOF); no process is ever signalled.
SCR=/home/matt/Development/helio/.concertino/scratch/HEL-1629
PGS=$SCR/pgprobe
export PGHOST=$PGS PGPORT=54329 PGUSER=postgres
ADMIN() { psql -q -At -d "$DB" "$@"; }
new_db() { # new_db <name> : fresh copy of the migrated template (probe1) with fixture loaded
  DB=$1
  psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB template probe1" >/dev/null
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$SCR/probes/fixture.sql" >/dev/null
}
FD=10
open() { # open <name> : psql session named via application_name
  local n=$1 f=$SCR/probes/run/$1
  mkdir -p $SCR/probes/run; rm -f $f.in $f.out; mkfifo $f.in
  PGAPPNAME=$n psql -q -At -v ON_ERROR_STOP=0 -d "$DB" < $f.in > $f.out 2>&1 &
  eval "exec $FD> $f.in"; eval "FD_$n=$FD"; FD=$((FD+1))
}
send() { local n=$1; shift; local v="FD_$n"; echo "$*" >&"${!v}"; }
close() { local v="FD_$1"; eval "exec ${!v}>&-"; }
out() { cat $SCR/probes/run/$1.out; }
state() { # state <name> : wait_event_type/wait_event/state of that session
  ADMIN -c "select coalesce(wait_event_type,'-')||'/'||coalesce(wait_event,'-')||'/'||state from pg_stat_activity where application_name='$1' and datname='$DB'"
}
await_lockwait() { # await_lockwait <name> [secs]
  local i; for i in $(seq 1 ${2:-100}); do
    [[ "$(state $1)" == Lock/* ]] && return 0; sleep 0.1; done; return 1; }
await_idle_tx() { local i; for i in $(seq 1 ${2:-100}); do [[ "$(state $1)" == */idle\ in\ transaction ]] && return 0; sleep 0.1; done; return 1; }
await_idle() { local i; for i in $(seq 1 ${2:-100}); do [[ "$(state $1)" == */idle ]] && return 0; sleep 0.1; done; return 1; }
blockers() { ADMIN -c "select application_name from pg_stat_activity where pid = any(pg_blocking_pids((select pid from pg_stat_activity where application_name='$1' and datname='$DB' limit 1)))"; }
