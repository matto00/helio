#!/usr/bin/env bash
# Probe 1.2: section 8.3 "earlier order" vs candidate order H, against a concurrent panel create.
source "$(dirname "$0")/lib.sh"
LOCKP="select hel1498_lock_panels(ARRAY[]::text[],ARRAY[]::text[],ARRAY['p1'],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]);"
run_case() { # run_case <order> <iteration>
  local order=$1 i=$2
  new_db pr12_${order,,}_$i
  open C; open S
  send C "begin;"
  send C "select 1 from dashboards where id='d1' for update;"        # panel create: dashboard FIRST
  await_idle_tx C
  send S "begin;"
  if [[ $order == earlier ]]; then
    send S "select 1 from pipelines where id='p1' for no key update;"
    send S "select 1 from outputs where pipeline_id='p1' order by id for update;"
  fi
  await_idle_tx S
  send C "insert into panels (id,dashboard_id,title,created_by,created_at,last_updated,appearance,owner_id,kind,output_id) values ('pn$i','d1','n','u',now(),now(),'{}','00000000-0000-0000-0000-0000000000a1','output','oa');"
  if [[ $order == earlier ]]; then
    await_lockwait C                               # C now waits on S's FOR UPDATE of oa
    send S "select 1 from panels where output_id in (select id from outputs where pipeline_id='p1') order by id for update;"
    send S "select 1 from dashboards where id in ('d1','d2') order by id for update;"   # S now wants d1, held by C
  else
    send S "$LOCKP"                                # H: panels, dashboards first
    await_lockwait S                               # S waits on d1 held by C
    send S "select 1 from pipelines where id='p1' for no key update;"
    send S "select 1 from outputs where pipeline_id='p1' order by id for update;"
  fi
  send C "commit;"; send S "commit;"
  sleep 1
  close C; close S; sleep 0.3
  echo "--- order=$order iter=$i"; echo "C: $(tr '\n' '|' < $SCR/probes/run/C.out)"; echo "S: $(tr '\n' '|' < $SCR/probes/run/S.out)"
}
for i in 1 2 3; do run_case earlier $i; done
for i in 1 2 3; do run_case H $i; done
