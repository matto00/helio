# HEL-599 — task 6.1/6.2: live probe transcript

Run against the local dev backend (this worktree, fix applied), targeting the real live
endpoint named in the ticket:
`https://api.sleeper.app/projections/nfl/2026?season_type=regular&order_by=pts_ppr&position[]=WR`

Date: 2026-08-28. Backend: `http://localhost:8938` (this worktree's `BACKEND_PORT`).

## 1. Login

```
$ curl -s -c /tmp/cookies.txt -X POST http://localhost:8938/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"matt@helio.dev","password":"heliodev123"}' -w "\n%{http_code}\n"
{"expiresAt":"2026-09-27T17:37:53.474366533Z","user":{...,"tier":"owner"}}
200
```

## 2. Create a Connector for `api.sleeper.app`

```
$ curl -s -b /tmp/cookies.txt -X POST http://localhost:8938/api/connectors \
    -H 'Content-Type: application/json' -H 'X-Helio-Requested-With: 1' \
    -d '{"name":"HEL-599 sleeper connector","kind":"rest_api","baseUrl":"https://api.sleeper.app","config":{"authType":"none"},"credential":"none"}' \
    -w "\n%{http_code}\n"
{"baseUrl":"https://api.sleeper.app", ..., "id":"d4362bc7-0257-4e52-9c88-43152f1b3b74", ...}
201
```

## 3. Create the REST source over the live endpoint (unset rootSelector — the root IS the array)

```
$ curl -s -b /tmp/cookies.txt -X POST http://localhost:8938/api/sources \
    -H 'Content-Type: application/json' -H 'X-Helio-Requested-With: 1' \
    -d '{"name":"HEL-599 Sleeper WR live probe","type":"rest_api",
         "config":{"connectorId":"d4362bc7-0257-4e52-9c88-43152f1b3b74",
                    "endpoint":"/projections/nfl/2026?season_type=regular&order_by=pts_ppr&position[]=WR",
                    "method":"GET"}}' \
    -w "\n%{http_code}\n"
201
```

Response `dataType.fields` (excerpt — the schema-inference side of the guarantee) includes, among
others:

```
{"name":"stats.pts_ppr","dataType":"float", ...}
{"name":"player.first_name","dataType":"string", ...}
{"name":"player.metadata.genius_id","dataType":"string", ...}
{"name":"player.metadata.rookie_year","dataType":"string", ...}
{"name":"player.metadata.channel_id","dataType":"string", ...}
```

No `stats` or `player` top-level field is present in the response — inference already recursed
correctly (this was true before this ticket too; the bug was on the row side).

## 4. Create a pipeline over that source (no steps — base-source materialisation only)

```
$ curl -s -b /tmp/cookies.txt -X POST http://localhost:8938/api/pipelines \
    -H 'Content-Type: application/json' -H 'X-Helio-Requested-With: 1' \
    -d '{"name":"HEL-599 live probe pipeline","sourceDataSourceId":"a23a884d-0198-43e1-b273-a1fde41accbe",
         "outputDataTypeName":"HEL-599 Sleeper WR probe rows","steps":[]}' \
    -w "\n%{http_code}\n"
{"id":"d37153b0-de5b-4754-b2f1-31ca004a0f34", ...}
201
```

## 5. Run the pipeline and read rows back

```
$ curl -s -b /tmp/cookies.txt -X POST \
    "http://localhost:8938/api/pipelines/d37153b0-de5b-4754-b2f1-31ca004a0f34/run" \
    -H 'Content-Type: application/json' -H 'X-Helio-Requested-With: 1' -d '{}' \
    -o hel599_run_full.json
```

`rowCount`: `1000` (the whole live response, one row per WR projection).

Row 0 (Puka Nacua), inspected with a small script:

```
$ python3 -c "
import json
data = json.load(open('hel599_run_full.json'))
print('rowCount', data['rowCount'])
row = data['rows'][0]
for k in ['stats.pts_ppr','player.first_name','player.metadata.genius_id',
          'player.metadata.rookie_year','player.fantasy_positions']:
    print(k, '=', row.get(k), type(row.get(k)))
print('has bare stats key?', 'stats' in row)
print('has bare player key?', 'player' in row)
"
rowCount 1000
stats.pts_ppr = 312.5 <class 'float'>
player.first_name = Puka <class 'str'>
player.metadata.genius_id = 1399238 <class 'str'>
player.metadata.rookie_year = 2023 <class 'str'>
player.fantasy_positions = ["WR"] <class 'str'>
has bare stats key? False
has bare player key? False
```

## Conclusion

Against the real live Sleeper endpoint (not a fixture):

- `stats.pts_ppr` materialises as `float` (matching the advertised schema), not as `null`.
- `player.first_name` and the third-level `player.metadata.*` keys materialise as strings.
- `player.fantasy_positions` (a JSON array) materialises as its compact-JSON leaf text, matching
  design D2 (arrays are leaves).
- No bare `stats`/`player` column survives alongside its dotted children — the field report's
  exact defect (dotted schema, un-flattened rows) is gone.

This confirms the fix end-to-end against the acceptance criterion's named endpoint, in addition
to the CI-safe verbatim-fixture regression tests (`NestedJsonFlatteningSymmetrySpec`).

Per design D7.4, this probe is deliberately NOT wired into the CI/commit-gate test suite — a
network-dependent test in the commit gate is a flake generator. This transcript is the run
evidence instead.

## Cleanup note

The probe-created Connector/DataSource/Pipeline/DataType rows above live only in this worktree's
local dev Postgres instance (not shared/prod state) and are not referenced by any other test or
fixture.
