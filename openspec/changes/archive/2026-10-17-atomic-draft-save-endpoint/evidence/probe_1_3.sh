#!/usr/bin/env bash
# Probe 1.3: D5 hazards (a) rewrite vs advisory-holding save, (d) node-snapshot txn vs (4), (e) alert evaluator vs (5).
source "$(dirname "$0")/lib.sh"
KEY=72901101
OWNER=00000000-0000-0000-0000-0000000000a1
dump() { echo "--- $1"; for s in "${@:2}"; do echo "$s: $(tr '\n' '|' < $SCR/probes/run/$s.out | cut -c1-260)"; done; }

probe_a() { # (a) rewriteUpsertTargetAction (step FOR UPDATE, THEN advisory) vs a save holding the advisory then writing the step
  new_db pr13_a; open R; open S
  send R "begin;"; send R "select 1 from pipeline_steps where id='t2' for update;"; await_idle_tx R
  send S "begin;"; send S "select pg_advisory_xact_lock($KEY);"; await_idle_tx S
  send R "select pg_advisory_xact_lock($KEY);"; await_lockwait R         # rewrite wants the advisory lock held by the save
  send S "update pipeline_steps set config='{\"x\":1}' where id='t2';"    # the save writes the very step the rewrite holds
  sleep 1; send R "commit;"; send S "commit;"; sleep 0.5; close R; close S; sleep 0.3
  dump "(a) step-row-then-advisory (current rewrite order) vs save advisory-then-step" R S
}
probe_a2() { # (a) with the restructured rewrite: advisory FIRST, then the step row
  new_db pr13_a2; open R; open S
  send S "begin;"; send S "select pg_advisory_xact_lock($KEY);"; await_idle_tx S
  send R "begin;"; send R "select pg_advisory_xact_lock($KEY);"; await_lockwait R   # rewrite takes the advisory first: waits behind the save
  send S "update pipeline_steps set config='{\"x\":1}' where id='t2';"
  send S "commit;"; sleep 0.5
  send R "select 1 from pipeline_steps where id='t2' for update;"; send R "commit;"; sleep 0.3; close R; close S; sleep 0.3
  dump "(a') advisory-then-step rewrite (restructured)" R S
}
probe_d() { # (d) snapshot txn key-shares Outputs in POSITION order (ob, oa); save locks FOR UPDATE by id (oa, ob) or by position
  for order in id position; do
    new_db pr13_d_$order; open N; open S
    send N "begin;"; send N "select 1 from pipelines where id='p1' for key share;"
    send N "insert into output_snapshot_history (output_id,pipeline_id,node_step_id,trigger_source,captured_at,row_count,summary) values ('ob','p1','t2','manual',now(),0,'{}');"  # first Output of the node (position 0)
    await_idle_tx N
    send S "begin;"
    if [[ $order == id ]]; then send S "select 1 from outputs where pipeline_id='p1' order by id for update;"
    else send S "select 1 from outputs where pipeline_id='p1' order by position, id for update;"; fi
    sleep 0.5
    send N "insert into output_snapshot_history (output_id,pipeline_id,node_step_id,trigger_source,captured_at,row_count,summary) values ('oa','p1','t2','manual',now(),0,'{}');"  # second Output (position 1)
    sleep 1; send N "commit;"; send S "commit;"; sleep 0.5; close N; close S; sleep 0.3
    dump "(d) save locks outputs by $order vs snapshot txn (history inserts in position order ob,oa)" N S
  done
}
probe_e() { # (e) alert-event insert (FK key-share on rule AND output) vs save locking outputs then rules, or rules then outputs
  for order in outputs_then_rules rules_then_outputs; do
    new_db pr13_e_$order; open E; open S
    send S "begin;"
    if [[ $order == outputs_then_rules ]]; then send S "select 1 from outputs where id='oa' for update;"; else send S "select 1 from alert_rules where id='ra' for update;"; fi
    await_idle_tx S
    send E "begin;"
    send E "insert into alert_events (id,alert_rule_id,owner_id,value,severity,state,first_fired_at,last_evaluated_at,target_output_id) values ('ev1','ra','$OWNER','1','warning','firing',now(),now(),'oa');"
    await_lockwait E
    if [[ $order == outputs_then_rules ]]; then send S "select 1 from alert_rules where id='ra' for update;"; else send S "select 1 from outputs where id='oa' for update;"; fi
    sleep 1; send E "commit;"; send S "commit;"; sleep 0.5; close E; close S; sleep 0.3
    dump "(e) save locks $order vs alert-event insert" E S
  done
}
probe_a; probe_a2; probe_d; probe_e
