# Backend Scaffold

Scala + Pekko backend scaffold.

No service implementation is included yet.

Planned structure:

- `src/main/scala/com/helio/app` runtime bootstrap
- `src/main/scala/com/helio/api` HTTP/API adapters
- `src/main/scala/com/helio/domain` domain models and logic
- `src/main/scala/com/helio/security` authn/authz and validation boundaries
- `src/main/scala/com/helio/infrastructure` persistence/external integrations
- `src/test/scala/com/helio` ScalaTest suites

---

## Dev DB repair

Over time the local dev DB can drift from what the application's ACL model expects.
The script `backend/scripts/repair-dev-db.sql` is a one-shot, idempotent fix for
the four known drift symptoms (HEL-267):

| #   | Symptom                                                                              | Root cause                                                                                                                               |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Panel bindings silently scrub back to `""` for six legacy DataTypes                  | V14/V15 added `owner_id` as a nullable column with no backfill; pre-V15 rows have `owner_id IS NULL`, which never matches any user       |
| 2   | Binding a panel to the "Profit" DataType (id `c1005183-…`) is immediately scrubbed   | That DataType is owned by the Google OAuth account (`0632ca2e-…`), not the primary dev account (`matt@helio.dev` / `9532cfcf-…`)         |
| 3   | `POST /api/pipelines/<profitagg-id>/run` returns 422 "DataSource not found for join" | The ProfitAgg join step has an empty config (`{}`); `rightDataSourceId` defaults to `""`, which resolves to nothing                      |
| 4   | ProfitAgg pipeline is invisible / returns 404 when run                               | V32 backfilled pre-existing pipelines to `SystemUserId` (`00000000-…-0001`); the ACL-scoped `findById` returns None for `matt@helio.dev` |

### Running the repair

```bash
# From repo root
psql $DATABASE_URL -f backend/scripts/repair-dev-db.sql
```

Or with the default local dev connection:

```bash
psql postgresql://matt@localhost:5432/helio -f backend/scripts/repair-dev-db.sql
```

Restart the backend after running — no Flyway migration is needed.

### Verifying success

After running the script, confirm each fix:

```sql
-- AC3: should return 0
SELECT COUNT(*) FROM data_types WHERE owner_id IS NULL;

-- AC2: owner_id should be 9532cfcf-9882-45ba-8247-23706bc00113
SELECT id, name, owner_id FROM data_types WHERE id = 'c1005183-0cbe-4631-ac62-95421e18f0a5';

-- AC1: config should contain rightDataSourceId
SELECT id, config FROM pipeline_steps WHERE id = '9607c209-421c-48b9-b4f2-1cb72b103092';

-- Pipeline owner should be 9532cfcf-9882-45ba-8247-23706bc00113
SELECT id, name, owner_id FROM pipelines WHERE id = '6c75e682-4a7c-469b-b9ba-5fda8e4adc42';
```

Then run:

```bash
# AC1: should return non-422 (200 or 202)
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:8080/api/pipelines/6c75e682-4a7c-469b-b9ba-5fda8e4adc42/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>"
```

### Note on DemoData and SystemUser ownership

`DemoData.scala` seeds dashboards and panels under `SystemUserId`
(`00000000-0000-0000-0000-000000000001`). This is pre-existing behavior and not a
blocker for normal dev workflows (dashboards/panels are fetched via RLS-bypassing
privileged context where appropriate).

**Any future addition of DataTypes, DataSources, or Pipelines to `DemoData`
must assign `owner_id` to a real user UUID** (e.g. the first registered user or
a fixed seed UUID), never to `SystemUserId` or left as NULL. Using `SystemUserId`
for data resources causes the same invisible-row drift described above.
