# HEL-1742 live RLS check as helio_app (non-BYPASSRLS), local dev DB only

Design D9. The local cluster has no helio_app role (only helio_privileged and a superuser), and the shared dev DB is at V140 (V141/V142 unapplied). So ONE psql transaction applies V141+V142, creates helio_app NOSUPERUSER NOBYPASSRLS, seeds fixtures as the superuser, SET LOCAL ROLE helio_app, exercises owner / grantee / stranger / no-context reads and a stranger insert, then ROLLBACKs. The final three queries prove no role, table or rows remain. Never run against prod. Script: scratch rls-live.sql (in .concertino/scratch/HEL-1742/, main checkout).

```
BEGIN
--- apply V141 + V142 INSIDE this transaction (shared dev DB is at V140; nothing persists)
ALTER TABLE
ALTER TABLE
ALTER TABLE
CREATE TABLE
CREATE INDEX
CREATE INDEX
ALTER TABLE
ALTER TABLE
CREATE POLICY
CREATE POLICY
CREATE POLICY
CREATE POLICY
GRANT
--- create helio_app: NOLOGIN NOSUPERUSER NOBYPASSRLS (does not exist on this cluster; vanishes on ROLLBACK)
CREATE ROLE
GRANT
GRANT
--- pg_roles proof
  rolname  | rolsuper | rolbypassrls 
-----------+----------+--------------
 helio_app | f        | f
(1 row)

--- fixtures as the superuser: owner, grantee, stranger; pipeline P; insight Output O; two insight rows
INSERT 0 3
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 2
--- switch to helio_app and prove the role in force
SET
 current_user | bypassrls | superuser 
--------------+-----------+-----------
 helio_app    | f         | f
(1 row)

--- owner (expect 2 rows)
              set_config              
--------------------------------------
 00000000-0000-0000-0000-0000000a0001
(1 row)

 owner_sees 
------------
          2
(1 row)

--- grantee (expect 2 rows)
              set_config              
--------------------------------------
 00000000-0000-0000-0000-0000000a0002
(1 row)

 grantee_sees 
--------------
            2
(1 row)

--- stranger (expect 0 rows)
              set_config              
--------------------------------------
 00000000-0000-0000-0000-0000000a0003
(1 row)

 stranger_sees 
---------------
             0
(1 row)

--- stranger INSERT (expect row-level security policy violation); savepoint so the transaction continues
SAVEPOINT
psql:/home/matt/Development/helio/.concertino/scratch/HEL-1742/rls-live.sql:45: ERROR:  new row violates row-level security policy for table "output_insights"
ROLLBACK
--- owner INSERT (expect INSERT 0 1)
              set_config              
--------------------------------------
 00000000-0000-0000-0000-0000000a0001
(1 row)

INSERT 0 1
--- no user context at all (expect 0 rows)
 set_config 
------------
 
(1 row)

 no_context_sees 
-----------------
               0
(1 row)

RESET
ROLLBACK
--- after ROLLBACK: no role, no table, no rows remain
 helio_app_roles 
-----------------
               0
(1 row)

 output_insights_table 
-----------------------
 
(1 row)

 leftover_users 
----------------
              0
(1 row)

```

> Renumbered V142 -> V145 after HEL-1739 merged V144 (C1). The transcript below was recorded as V142; the DDL body is byte-identical, only the file name changed.
