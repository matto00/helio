# HEL-1193 task 0.2 - live backend status-code probes (unmodified main backend, port 9532, cwd verified = this worktree/backend)

Panel PATCH probes target an output panel bound to Output ab6aab08 (schema: amount integer, created_at timestamp, region string).

### ineligible control (date-range on string col) -> HTTP 400 :: {"message":"control not eligible: column 'region', kind 'date-range'"}
### unknown column -> HTTP 400 :: {"message":"control not eligible: column 'nope', kind 'date-range'"}
### unknown kind -> HTTP 400 :: {"message":"control not eligible: column 'created_at', kind 'slider'"}
### missing id -> HTTP 500 :: {"message":"Internal server error"}
### malformed control (controls is a string) -> HTTP 500 :: {"message":"Internal server error"}
### malformed control (element not object) -> HTTP 500 :: {"message":"Internal server error"}
### duplicate control ids (both eligible) -> HTTP 200 :: {"appearance":{"background":"transparent","color":"inherit","transparency":0.0},"config":{"controls":[{"id":"44444444-4444-4444-8444-444444444444","kind":"date-range","column":"created_at","label":"A"},{"id":"44444444-4444-4444-8444-444444444444","kind":"text","column":"region","label":"B"}],"outputId":"ab6aab08-454d-41af-8cb9-4c003533db98"},"dashboardId":"e690e243-5000-4e12-9f95-6440128808ed","id
### unknown panel id (valid uuid) -> HTTP 404 :: {"message":"Panel not found"}
### non-uuid panel id -> HTTP 404 :: {"message":"Panel not found"}
### get panel state after dup-id write -> HTTP 200 :: {"dashboard":{"appearance":{"background":"transparent","gridBackground":"transparent"},"layout":{"lg":[{"h":6,"panelId":"2a8b9ccc-3424-475f-ad8a-a10117c13296","w":6,"x":0,"y":0},{"h":6,"panelId":"8434f0f1-badf-445b-bf23-a761c1a376a4","w":6,"x":0,"y":6},{"h":4,"panelId":"141c964b-bc38-4059-b455-3a1790b9de67","w":6,"x":0,"y":12}],"md":[{"h":6,"panelId":"2a8b9ccc-3424-475f-ad8a-a10117c13296","w":5,"x
[{"id":"44444444-4444-4444-8444-444444444444","kind":"date-range","column":"created_at","label":"A"},{"id":"44444444-4444-4444-8444-444444444444","kind":"text","column":"region","label":"B"}]
[]
### create text panel (scratch) -> HTTP 201 :: {"appearance":{"background":"transparent","color":"inherit","transparency":0.0},"config":{"content":""},"dashboardId":"e690e243-5000-4e12-9f95-6440128808ed","id":"f53d87d7-a60d-46aa-ac3b-44c581d02074","meta":{"createdAt":"2026-09-30T05:24:38.864730532Z","createdBy":"9532cfcf-9882-45ba-8247-23706bc00
### text panel PATCH with config.controls -> HTTP 200 :: {"appearance":{"background":"transparent","color":"inherit","transparency":0.0},"config":{"content":""},"dashboardId":"e690e243-5000-4e12-9f95-6440128808ed","id":"f53d87d7-a60d-46aa-ac3b-44c581d02074","meta":{"createdAt":"2026-09-30T05:24:38.864731Z","createdBy":"9532cfcf-9882-45ba-8247-23706bc00113
### delete scratch panel -> HTTP 204 :: 
### POST output panel bound to unknown output with controls -> HTTP 404 :: {"message":"Output not found"}
### GET filter-capabilities unknown output -> HTTP 404 :: {"message":"Output not found"}
### GET filter-capabilities no auth -> HTTP 401 :: {"message":"Unauthorized"}
### propose (http://localhost:9532/api/dashboards/propose?) route discovery -> HTTP 401 :: {"message":"Unauthorized"}
### apply-proposal, ineligible config.controls (main: apply-time) -> HTTP 400 :: {"message":"control not eligible: column 'region', kind 'date-range'"}
### list dashboards named hel1193-probe (was one left behind by the failed apply?) -> HTTP 200 :: {"items":[{"appearance":{"background":"transparent","gridBackground":"transparent"},"id":"e690e243-5000-4e12-9f95-6440128808ed","layout":{"lg":[{"h":6,"panelId":"2a8b9ccc-3424-475f-ad8a-a10117c13296","w":6,"x":0,"y":0},{"h":6,"panelId":"8434f0f1-badf-445b-bf23-a761c1a376a4","w":6,"x":0,"y":6},{"h":4
### create scratch dashboard -> HTTP 201 :: {"appearance":{"background":"transparent","gridBackground":"transparent"},"id":"0c82aaf4-da21-40bf-b76c-bc55ab233429","layout":{"lg":[],"md":[],"sm":[],"xs":[]},"meta":{"createdAt":"2026-09-30T05:25:12.424619617Z","createdBy":"9532cfcf-9882-45ba-8247-23706bc00113","lastUpdated":"2026-09-30T05:25:12.
### PUT contents, ineligible config.controls -> HTTP 400 :: {"message":"control not eligible: column 'region', kind 'date-range'"}
### PUT contents, two panels: valid first then ineligible: dashboard left with? -> HTTP 400 :: {"message":"control not eligible: column 'region', kind 'date-range'"}
### PUT contents, duplicate control ids on eligible controls -> HTTP 200 :: {"dashboard":{"appearance":{"background":"transparent","gridBackground":"transparent"},"id":"0c82aaf4-da21-40bf-b76c-bc55ab233429","layout":{"lg":[],"md":[],"sm":[],"xs":[]},"meta":{"createdAt":"2026-09-30T05:25:12.424620Z","createdBy":"9532cfcf-9882-45ba-8247-23706bc00113","lastUpdated":"2026-09-30
### PUT contents, top-level controls key (unknown to ProposalPanel) -> HTTP 200 :: {"dashboard":{"appearance":{"background":"transparent","gridBackground":"transparent"},"id":"0c82aaf4-da21-40bf-b76c-bc55ab233429","layout":{"lg":[],"md":[],"sm":[],"xs":[]},"meta":{"createdAt":"2026-09-30T05:25:12.424620Z","createdBy":"9532cfcf-9882-45ba-8247-23706bc00113","lastUpdated":"2026-09-30

## Additional probes
export 00000000-0000-4000-8000-000000000000 -> 404 {"message":"Dashboard not found"}
export not-a-uuid -> 404 {"message":"Dashboard not found"}
### patch-sets/apply with ineligible panelPatch.config.controls -> HTTP 200 :: {"edits":[],"failure":"control not eligible: column 'region', kind 'date-range'"}
