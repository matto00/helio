# HEL-1475 read-only orphan counts (for the PR body)

Run as a role that bypasses RLS (an owner/privileged connection); under the app role each owner sees only their own rows.
Both are plain `SELECT count(*)`: no delete, no migration. `InlineSourceOrphanCountQueriesSpec` runs these exact statements
against the embedded Postgres schema (migrated through the latest Flyway version) over seeded rows and asserts the counts.

**(a) UPPER BOUND on implicit Connectors no data source references.** Not a count of this ticket's leak: `DataSourceService.delete` never
removes a Connector, so every ordinary user delete of a bare-`url`-created REST source also leaves its `Auto:` Connector
unreferenced, and this counts those too (causes are mixed: this leak, normal deletes, failed creates before the fix). It
undercounts only a Connector renamed away from `Auto: `.

```sql
SELECT count(*) FROM connectors c
WHERE c.name LIKE 'Auto: %'
  AND NOT EXISTS (
    SELECT 1 FROM data_sources d
    WHERE d.source_type = 'rest_api' AND d.config ->> 'connectorId' = c.id::text
  );
```

**(b) UPPER BOUND on inline-root-shaped orphan sources** -- sources of an inline-root kind that no pipeline roots on. This is an
upper bound, not a count of leaks: an unreferenced source can be intentional (created on the Sources page, or by `POST
/api/sources` and never used yet), and a source referenced only by a panel/alert but not a pipeline root is still counted.

```sql
SELECT count(*) FROM data_sources d
WHERE d.source_type IN ('sql', 'rest_api', 'dataset')
  AND NOT EXISTS (SELECT 1 FROM pipeline_roots r WHERE r.data_source_id = d.id);
```
