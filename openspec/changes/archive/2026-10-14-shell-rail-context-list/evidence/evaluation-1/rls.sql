\set ON_ERROR_STOP off
\set ON_ERROR_ROLLBACK on
BEGIN;
CREATE ROLE eval1574_app NOSUPERUSER NOBYPASSRLS NOLOGIN;
CREATE ROLE eval1574_owner NOSUPERUSER NOBYPASSRLS NOLOGIN;
GRANT USAGE ON SCHEMA public TO eval1574_app, eval1574_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard_folders, dashboard_folder_assignments, dashboards, users TO eval1574_app, eval1574_owner;
ALTER TABLE dashboard_folders OWNER TO eval1574_owner;
ALTER TABLE dashboard_folder_assignments OWNER TO eval1574_owner;
INSERT INTO users (id, email, created_at) VALUES ('11111111-1574-4000-8000-00000000000a','eval1574a@example.test',now()),('11111111-1574-4000-8000-00000000000b','eval1574b@example.test',now());
INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id) VALUES
 ('eval1574-dash-a','a','11111111-1574-4000-8000-00000000000a',now(),now(),'{}','{"lg":[],"md":[],"sm":[],"xs":[]}','11111111-1574-4000-8000-00000000000a'),
 ('eval1574-dash-b','b','11111111-1574-4000-8000-00000000000b',now(),now(),'{}','{"lg":[],"md":[],"sm":[],"xs":[]}','11111111-1574-4000-8000-00000000000b');
\echo === relrowsecurity/force
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('dashboard_folders','dashboard_folder_assignments');
\echo ##### ROLE eval1574_owner (table owner; FORCE RLS)
SET LOCAL ROLE eval1574_owner;
SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user;
\echo --- no context select (expect error)
SELECT count(*) FROM dashboard_folders;
SET LOCAL app.current_user_id = '11111111-1574-4000-8000-00000000000a';
INSERT INTO dashboard_folders (id, owner_id, name) VALUES ('22222222-1574-4000-8000-00000000000a','11111111-1574-4000-8000-00000000000a','A folder');
INSERT INTO dashboard_folder_assignments VALUES ('11111111-1574-4000-8000-00000000000a','eval1574-dash-a','22222222-1574-4000-8000-00000000000a');
SET LOCAL app.current_user_id = '11111111-1574-4000-8000-00000000000b';
\echo --- B sees A rows? (expect 0 0)
SELECT (SELECT count(*) FROM dashboard_folders WHERE owner_id='11111111-1574-4000-8000-00000000000a') AS folders_of_a, (SELECT count(*) FROM dashboard_folder_assignments) AS assignments_visible;
\echo --- B inserts folder owned by A (expect RLS error)
INSERT INTO dashboard_folders (id, owner_id, name) VALUES ('22222222-1574-4000-8000-0000000000ff','11111111-1574-4000-8000-00000000000a','evil');
\echo --- B inserts assignment owned by A (expect RLS error)
INSERT INTO dashboard_folder_assignments VALUES ('11111111-1574-4000-8000-00000000000a','eval1574-dash-b','22222222-1574-4000-8000-00000000000a');
\echo --- B files own row into A folder (expect FK error)
INSERT INTO dashboard_folder_assignments VALUES ('11111111-1574-4000-8000-00000000000b','eval1574-dash-b','22222222-1574-4000-8000-00000000000a');
\echo --- B update/delete A folder (expect UPDATE 0 / DELETE 0)
UPDATE dashboard_folders SET name='hijack' WHERE id='22222222-1574-4000-8000-00000000000a';
DELETE FROM dashboard_folders WHERE id='22222222-1574-4000-8000-00000000000a';
\echo ##### ROLE eval1574_app (non-owner)
RESET ROLE;
SET LOCAL ROLE eval1574_app;
SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user;
SET LOCAL app.current_user_id = '11111111-1574-4000-8000-00000000000b';
SELECT (SELECT count(*) FROM dashboard_folders WHERE owner_id='11111111-1574-4000-8000-00000000000a') AS folders_of_a, (SELECT count(*) FROM dashboard_folder_assignments) AS assignments_visible;
INSERT INTO dashboard_folders (id, owner_id, name) VALUES ('22222222-1574-4000-8000-0000000000fe','11111111-1574-4000-8000-00000000000a','evil');
SET LOCAL app.current_user_id = '11111111-1574-4000-8000-00000000000a';
\echo --- A sees own (expect 1 1)
SELECT (SELECT count(*) FROM dashboard_folders WHERE owner_id='11111111-1574-4000-8000-00000000000a'), (SELECT count(*) FROM dashboard_folder_assignments);
\echo --- A moves own folder to B (expect WITH CHECK error)
UPDATE dashboard_folders SET owner_id='11111111-1574-4000-8000-00000000000b' WHERE id='22222222-1574-4000-8000-00000000000a';
RESET ROLE;
ROLLBACK;
\echo --- after rollback, leftovers (expect 0 0)
SELECT (SELECT count(*) FROM pg_roles WHERE rolname LIKE 'eval1574%'), (SELECT count(*) FROM users WHERE email LIKE 'eval1574%');
