#!/usr/bin/env bash
# Probe 1.4 (H'): source rows at the front of the order. (i) source delete vs root add on the same source,
# (ii) workspace teardown (panels -> pipelines -> sources) vs source delete (source -> panels -> ...).
source "$(dirname "$0")/lib.sh"
dump() { echo "--- $1"; for s in "${@:2}"; do echo "$s: $(tr '\n' '|' < $SCR/probes/run/$s.out | cut -c1-300)"; done; }
LOCKP_DS="select hel1498_lock_panels(ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY['ds1']);"
ROOTS_FOR_DS1="select pipeline_id from pipeline_roots where data_source_id='ds1' order by pipeline_id;"
LOCKP="select 1 from pipelines where id in ('p1','p2') order by id for no key update;"

probe_i() {
  for first in add delete; do
    new_db pr14_i_$first; open A; open D
    if [[ $first == add ]]; then
      send A "begin;"; send A "select 1 from data_sources where id='ds1' for key share;"
      send A "select pg_advisory_xact_lock(72901101);"; send A "select 1 from pipelines where id='p2' for no key update;"
      send A "insert into pipeline_roots (id,pipeline_id,data_source_id,position,created_at) values ('r9','p2','ds1',2,now());"
      await_idle_tx A
      send D "begin;"; send D "select 1 from data_sources where id='ds1' for update;"; await_lockwait D   # D waits behind A's key share
      send A "commit;"; sleep 0.5
      send D "$LOCKP_DS"; send D "$ROOTS_FOR_DS1"; send D "$LOCKP"; send D "delete from data_sources where id='ds1';"; send D "commit;"
    else
      send D "begin;"; send D "select 1 from data_sources where id='ds1' for update;"; send D "$LOCKP_DS"; await_idle_tx D
      send A "begin;"; send A "select 1 from data_sources where id='ds1' for key share;"; await_lockwait A   # A waits behind D's FOR UPDATE
      send D "$ROOTS_FOR_DS1"; send D "$LOCKP"; send D "delete from data_sources where id='ds1';"; send D "commit;"; sleep 0.5
      send A "select pg_advisory_xact_lock(72901101);"; send A "insert into pipeline_roots (id,pipeline_id,data_source_id,position,created_at) values ('r9','p2','ds1',2,now());"; send A "commit;"
    fi
    sleep 1; close A; close D; sleep 0.3
    dump "(i) first=$first: root add (key-share source first) vs source delete (source FOR UPDATE first)" A D
    echo "roots left on ds1 / p2: $(ADMIN -c "select count(*) from pipeline_roots where pipeline_id='p2'")"
  done
}
probe_ii() {
  for tear in panels_first sources_first; do
    new_db pr14_ii_$tear; open T; open D
    send D "begin;"; send D "select 1 from data_sources where id='ds1' for update;"                    # user source delete: source first
    if [[ $tear == sources_first ]]; then
      send T "begin;"; send T "select 1 from data_sources where id='ds1' for update;"; await_lockwait T  # teardown takes tagged sources first: queues behind D
      send D "$LOCKP_DS"; send D "delete from data_sources where id='ds1';"; send D "commit;"; sleep 0.5
      send T "$LOCKP_DS"; send T "commit;"
    else
      send T "begin;"; send T "$LOCKP_DS"; await_idle_tx T                                              # teardown: panels first (current order)
      send D "$LOCKP_DS"; await_lockwait D                                                               # D wants the panels T holds
      send T "delete from data_sources where id='ds1';"                                                  # T wants the source row D holds
      sleep 1; send T "commit;"; send D "commit;"
    fi
    sleep 1; close T; close D; sleep 0.3
    dump "(ii) teardown order=$tear vs source delete (source row first)" T D
  done
}
probe_i; probe_ii
