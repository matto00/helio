insert into users (id,email,created_at,updated_at,tier) values
 ('00000000-0000-0000-0000-0000000000a1','u1@x',now(),now(),'owner'),
 ('00000000-0000-0000-0000-0000000000a2','u2@x',now(),now(),'owner');
insert into data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) values
 ('ds1','ds1','dataset','{}',now(),now(),'00000000-0000-0000-0000-0000000000a1','[]'),
 ('ds2','ds2','dataset','{}',now(),now(),'00000000-0000-0000-0000-0000000000a1','[]');
insert into pipelines (id,name,created_at,updated_at,owner_id) values
 ('p1','p1',now(),now(),'00000000-0000-0000-0000-0000000000a1'),
 ('p2','p2',now(),now(),'00000000-0000-0000-0000-0000000000a1');
insert into pipeline_roots (id,pipeline_id,data_source_id,position,created_at) values
 ('r1','p1','ds1',0,now()),('r2','p2','ds1',0,now()),('r1b','p1','ds2',1,now()),('r2b','p2','ds2',1,now());
insert into pipeline_steps (id,pipeline_id,position,op,config,created_at,updated_at,enabled,parent_step_id,root_id) values
 ('t1','p1',0,'filter','{}',now(),now(),true,null,'r1');
insert into pipeline_steps (id,pipeline_id,position,op,config,created_at,updated_at,enabled,parent_step_id,root_id) values
 ('t2','p1',0,'filter','{}',now(),now(),true,'t1',null),
 ('t3','p1',1,'filter','{}',now(),now(),true,'t1',null);
-- two Outputs on node t2: id order (oa < ob) is the REVERSE of position order (ob first)
insert into outputs (id,pipeline_id,node_step_id,owner_id,name,kind,config,schema,position,created_at,updated_at,root_id) values
 ('oa','p1','t2','00000000-0000-0000-0000-0000000000a1','oa','table','{}','[]',1,now(),now(),null),
 ('ob','p1','t2','00000000-0000-0000-0000-0000000000a1','ob','table','{}','[]',0,now(),now(),null),
 ('oc','p1','t3','00000000-0000-0000-0000-0000000000a1','oc','table','{}','[]',2,now(),now(),null);
insert into dashboards (id,name,created_by,created_at,last_updated,appearance,layout,owner_id) values
 ('d1','d1','u','2020-01-01',now(),'{}','{"lg":[],"md":[],"sm":[],"xs":[]}','00000000-0000-0000-0000-0000000000a1'),
 ('d2','d2','u','2020-01-01',now(),'{}','{"lg":[],"md":[],"sm":[],"xs":[]}','00000000-0000-0000-0000-0000000000a1');
insert into panels (id,dashboard_id,title,created_by,created_at,last_updated,appearance,owner_id,kind,output_id) values
 ('pa','d1','pa','u',now(),now(),'{}','00000000-0000-0000-0000-0000000000a1','output','oa'),
 ('pb','d2','pb','u',now(),now(),'{}','00000000-0000-0000-0000-0000000000a1','output','ob');
insert into alert_rules (id,owner_id,metric,condition,name,enabled,severity,created_at,updated_at,target_output_id) values
 ('ra','00000000-0000-0000-0000-0000000000a1','m','{}','ra',true,'warning',now(),now(),'oa'),
 ('rb','00000000-0000-0000-0000-0000000000a1','m','{}','rb',true,'warning',now(),now(),'ob');
