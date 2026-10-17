#!/usr/bin/env bash
# Probe 1.5 (amendment A5): Output delete of an Output with an alert rule and NO bound panel (DELETE output, cascade to its alert rule) vs a save locking rules then Outputs (A2).
source "$(dirname "$0")/lib.sh"
dump() { echo "--- $1"; for s in "${@:2}"; do echo "$s: $(tr '\n' '|' < $SCR/probes/run/$s.out | cut -c1-260)"; done; }
LOCKP="select hel1498_lock_panels(ARRAY[]::text[],ARRAY['oc'],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]);"
for variant in delete_without_pipeline_lock delete_takes_pipeline_lock; do
  new_db pr15_$variant; ADMIN -c "insert into alert_rules (id,owner_id,metric,condition,name,enabled,severity,created_at,updated_at,target_output_id) values ('rc','00000000-0000-0000-0000-0000000000a1','m','{}','rc',true,'warning',now(),now(),'oc')" >/dev/null; open W; open S
  send S "begin;"; send S "select hel1498_lock_panels(ARRAY[]::text[],ARRAY[]::text[],ARRAY['p1'],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]);"
  send S "select 1 from pipelines where id='p1' for no key update;"
  send S "select 1 from alert_rules where target_output_id in (select id from outputs where pipeline_id='p1') order by id for update;"   # (5) first
  await_idle_tx S
  send W "begin;"; send W "$LOCKP"
  [[ $variant == delete_takes_pipeline_lock ]] && send W "select 1 from pipelines where id='p1' for no key update;"
  send W "delete from panels where output_id='oc';"; send W "delete from outputs where id='oc';"
  sleep 1
  send S "select 1 from outputs where pipeline_id='p1' order by position, id for update;"                                                    # then (4)
  sleep 1; send S "commit;"; send W "commit;"; sleep 0.5; close W; close S; sleep 0.3
  dump "(A5) $variant: Output delete vs save locking rules, then Outputs" W S
done
