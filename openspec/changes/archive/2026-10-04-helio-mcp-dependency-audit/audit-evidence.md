# HEL-1204 audit evidence

CI command (C1, exact): `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp` (root-pinned audit-ci, run from repo root). Dependabot-0 AC is post-merge only (C3); `npm audit` 0 below is a proxy.

## 1. Pre-bump: npm audit (helio-mcp/, original lockfile)

```
# npm audit report

fast-uri  3.0.0 - 3.1.7
Severity: moderate
fast-uri vulnerable to inconsistent host case normalization via percent-encoded octets - https://github.com/advisories/GHSA-hrr3-gc8f-f4qj
fix available via `npm audit fix`
node_modules/fast-uri

hono  <=4.13.6
Severity: moderate
Hono: Incomplete fix for CVE-2026-39408: `toSSG()` still writes files outside the output directory - https://github.com/advisories/GHSA-gqvv-2mrq-wpjv
Hono: Unbounded dot-notation nesting in `parseBody()` can cause memory exhaustion - https://github.com/advisories/GHSA-g6gw-c38x-mqfc
Hono: Query parser reads parameters after the URL fragment, causing cache-key and proxy interpretation differentials - https://github.com/advisories/GHSA-crvj-82cr-hjcx
hono/jsx renders plain strings unescaped in boundary components, leading to XSS - https://github.com/advisories/GHSA-hxh3-vqpv-xpqv
fix available via `npm audit fix`
node_modules/hono

ip-address  <=10.7.0
Severity: moderate
ip-address: Address6.isLinkLocal() recognizes fe80::/64 rather than fe80::/10, allowing SSRF and trust-boundary bypass to on-link hosts - https://github.com/advisories/GHSA-rpw4-54j3-4h4q
ip-address: no classifier recognizes the NAT64 local-use range 64:ff9b:1::/48, allowing SSRF and trust-boundary bypass - https://github.com/advisories/GHSA-2vr4-cq9g-pvrc
ip-address: isInSubnet() and isHostInSubnet() compare addresses of different families as if they shared an address space, allowing an allowlist check to admit an address outside its range - https://github.com/advisories/GHSA-j6r3-76f7-8jcv
ip-address: Address6 builds a parse diagnostic proportional to the input with no length bound, allowing a single long string to stall or crash the process - https://github.com/advisories/GHSA-h3mg-xc3c-68pw
fix available via `npm audit fix`
node_modules/ip-address

3 moderate severity vulnerabilities

To address all issues, run:
  npm audit fix
exit 1
```

## 2. Pre-bump: npm ls hono ip-address fast-uri

```
helio-mcp@0.1.0 /home/matt/Development/helio/.claude/worktrees/task/helio-mcp-dep-audit/hel-1204/helio-mcp
└─┬ @modelcontextprotocol/sdk@1.29.0
  ├─┬ @hono/node-server@1.19.17
  │ └── hono@4.13.2 deduped
  ├─┬ ajv@8.20.0
  │ └── fast-uri@3.1.7 overridden
  ├─┬ express-rate-limit@8.5.2
  │ └── ip-address@10.5.0
  └── hono@4.13.2

```

## 3. Red-first: exact CI command, original lockfile (sha256 below), moderate config
```
a9e0fe2194c4c6237295c626013a798faa5e321f4635aba7224073c5efb08c4a  helio-mcp/package-lock.json
```

(full audit-ci JSON report elided to the advisory list; exit status is the point)

```
Found vulnerable advisory paths:
GHSA-2vr4-cq9g-pvrc|ip-address
GHSA-crvj-82cr-hjcx|hono
GHSA-g6gw-c38x-mqfc|hono
GHSA-gqvv-2mrq-wpjv|hono
GHSA-h3mg-xc3c-68pw|ip-address
GHSA-hrr3-gc8f-f4qj|fast-uri
GHSA-hxh3-vqpv-xpqv|hono
GHSA-j6r3-76f7-8jcv|ip-address
GHSA-rpw4-54j3-4h4q|ip-address
Failed security audit due to moderate vulnerabilities.
Vulnerable advisories are:
https://github.com/advisories/GHSA-2vr4-cq9g-pvrc
https://github.com/advisories/GHSA-crvj-82cr-hjcx
https://github.com/advisories/GHSA-g6gw-c38x-mqfc
https://github.com/advisories/GHSA-gqvv-2mrq-wpjv
https://github.com/advisories/GHSA-h3mg-xc3c-68pw
https://github.com/advisories/GHSA-hrr3-gc8f-f4qj
https://github.com/advisories/GHSA-hxh3-vqpv-xpqv
https://github.com/advisories/GHSA-j6r3-76f7-8jcv
https://github.com/advisories/GHSA-rpw4-54j3-4h4q
Exiting...
exit 1
```

## 4. Control: same original lockfile, same dir, config with "high": true instead of "moderate"
```
}
Passed npm security audit.
exit 0
```
Control exits 0: a "high" gate would be green on the vulnerable lockfile, so D2 (moderate) is necessary.

## 5. Remediation: npm audit fix (no --force)

```

changed 3 packages, and audited 100 packages in 2s

found 0 vulnerabilities
exit 0
```

`git diff helio-mcp/package.json` is empty (0 lines): package.json unchanged; lockfile-only, 9 lines changed.

## 6. Post-bump: npm audit

```
found 0 vulnerabilities
exit 0
```

## 7. Post-bump: npm ls

```
helio-mcp@0.1.0 /home/matt/Development/helio/.claude/worktrees/task/helio-mcp-dep-audit/hel-1204/helio-mcp
└─┬ @modelcontextprotocol/sdk@1.29.0
  ├─┬ @hono/node-server@1.19.17
  │ └── hono@4.13.13 deduped
  ├─┬ ajv@8.20.0
  │ └── fast-uri@3.1.8 overridden
  ├─┬ express-rate-limit@8.5.2
  │ └── ip-address@10.7.3
  └── hono@4.13.13

```

## 8. Post-bump: exact CI command
```
}
Passed npm security audit.
exit 0
```

## 9. Red-gate (C2): bump committed first (5fb79639), then hono reintroduced at 4.13.2, then reverted via git checkout
```
## committed bumped lockfile
5fb796391aa10acade1f188a56deeb741b3d52fc
ba3e736f42fedb177acfcc64f27d9922b26d4335e655c0c7248b069bc9325dac  helio-mcp/package-lock.json
1104:    "node_modules/hono": {
1105-      "version": "4.13.13",
1106-      "resolved": "https://registry.npmjs.org/hono/-/hono-4.13.13.tgz",
1107-      "integrity": "sha512-CQ46U0ZkAGmbT/4UxdzzGJpacP2IeKgY4a5/tOI9AABbpOMfK739wfDXmv1usCk+3RkKj1hQy4/fjhiwa2xlrA==",
## after reintroducing hono 4.13.2
8a5683e9b13fc8a13239af647520dc8c0c9540e0c1cd35f6a7afd287f0d3f4dd  helio-mcp/package-lock.json
 helio-mcp/package-lock.json | 6 +++---
 1 file changed, 3 insertions(+), 3 deletions(-)
1104:    "node_modules/hono": {
1105-      "version": "4.13.2",
1106-      "resolved": "https://registry.npmjs.org/hono/-/hono-4.13.2.tgz",
1107-      "integrity": "sha512-JydRilDRkYBQMt9qR9U92mXxmbGqsqSn/IKOrh4e7/gEbn+0zSr8igTu0obwJoNGN4sez28DIql7FBHWydoJpA==",
## exact CI command
Found vulnerable advisory paths:
GHSA-crvj-82cr-hjcx|hono
GHSA-g6gw-c38x-mqfc|hono
GHSA-gqvv-2mrq-wpjv|hono
GHSA-hxh3-vqpv-xpqv|hono
Failed security audit due to moderate vulnerabilities.
Vulnerable advisories are:
https://github.com/advisories/GHSA-crvj-82cr-hjcx
https://github.com/advisories/GHSA-g6gw-c38x-mqfc
https://github.com/advisories/GHSA-gqvv-2mrq-wpjv
https://github.com/advisories/GHSA-hxh3-vqpv-xpqv
Exiting...
exit 1
## after revert (git checkout)
ba3e736f42fedb177acfcc64f27d9922b26d4335e655c0c7248b069bc9325dac  helio-mcp/package-lock.json
}
Passed npm security audit.
exit 0
```
Reverted sha256 equals committed sha256 (ba3e736f...), git status/diff empty.

## 10. Reachability (D6)
```
$ grep -rnE "hono|ip-address|express-rate-limit|fast-uri|ajv|@modelcontextprotocol/sdk" src scripts (non-test imports of sdk)
src/server.ts:11:import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
src/server.ts:12:import { McpServer as McpServerImpl } from "@modelcontextprotocol/sdk/server/mcp.js";
src/index.ts:17:import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
src/tools/combinedProposal.ts:24:import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
src/tools/combinedProposal.ts:25:import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
src/tools/outputControls.ts:7:import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
src/tools/outputControls.ts:8:import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
src/tools/placements.ts:10:import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
src/tools/placements.ts:11:import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
src/tools/refinement.ts:13:import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
src/tools/refinement.ts:14:import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
src/tools/pipelines.ts:14:import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
src/tools/pipelines.ts:15:import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
src/tools/read.ts:10:import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
src/tools/read.ts:11:import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
src/tools/outputs.ts:15:import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
src/tools/outputs.ts:16:import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
src/tools/connectorHandlers.ts:9:import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
src/tools/pipelineProposal.ts:24:import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
src/tools/pipelineProposal.ts:25:import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
src/tools/proposal.ts:28:import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
src/tools/proposal.ts:29:import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
scripts/verify.ts:12:import { Client } from "@modelcontextprotocol/sdk/client/index.js";
scripts/verify.ts:13:import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
src/tools/write.ts:10:import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
src/tools/write.ts:11:import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
$ grep -rnE "hono|ip-address|express-rate-limit|fast-uri|\"ajv" src scripts
src/tools/assertSchemas.ts:123:  // The backend honours attachAsTail ONLY with parentStepId; with rootId or no anchor it would be
$ SDK files importing hono / @hono/node-server:
node_modules/@modelcontextprotocol/sdk/dist/esm/examples/server/honoWebStandardStreamableHttp.js
node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js
$ SDK files importing express-rate-limit:
node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/register.js
node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/token.d.ts
node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/revoke.js
node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/authorize.d.ts
node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/authorize.js
node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/register.d.ts
node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/token.js
node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/revoke.d.ts
$ SDK files importing ajv / fast-uri:
node_modules/@modelcontextprotocol/sdk/dist/esm/examples/client/simpleStreamableHttp.js
node_modules/@modelcontextprotocol/sdk/dist/esm/validation/ajv-provider.js
node_modules/@modelcontextprotocol/sdk/dist/esm/validation/ajv-provider.d.ts
$ SDK stdio.js and server/index.js import graph (non-type):
import { mergeCapabilities, Protocol } from '../shared/protocol.js';
import { CreateMessageResultSchema, CreateMessageResultWithToolsSchema, ElicitResultSchema, EmptyResultSchema, ErrorCode, InitializedNotificationSchema, InitializeRequestSchema, LATEST_PROTOCOL_VERSIO
import { AjvJsonSchemaValidator } from '../validation/ajv-provider.js';
import { getObjectShape, isZ4Schema, safeParse } from './zod-compat.js';
import { ExperimentalServerTasks } from '../experimental/tasks/server.js';
import { assertToolsCallTaskCapability, assertClientRequestTaskCapability } from '../experimental/tasks/helpers.js';
import { Server } from './index.js';
import { normalizeObjectSchema, safeParseAsync, getObjectShape, objectFromShape, getParseErrorMessage, getSchemaDescription, isSchemaOptional, getLiteralValue } from './zod-compat.js';
import { toJsonSchemaCompat } from './zod-json-schema-compat.js';
import { McpError, ErrorCode, ListResourceTemplatesRequestSchema, ReadResourceRequestSchema, ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ListPromptsRequestSchema, GetPro
import { isCompletable, getCompleter } from './completable.js';
import { UriTemplate } from '../shared/uriTemplate.js';
import { validateAndWarnToolName } from '../shared/toolNameValidation.js';
import { ExperimentalMcpServerTasks } from '../experimental/tasks/mcp-server.js';
import { ZodOptional } from 'zod';
import process from 'node:process';
import { ReadBuffer, serializeMessage } from '../shared/stdio.js';
$ ip-address importers (node_modules, excluding itself)
```

Findings:
- hono / @hono/node-server: imported only by the SDK's `server/streamableHttp.js` (+ an example). helio-mcp imports `StdioServerTransport` only and never `streamableHttp` -> UNREACHABLE from helio-mcp.
- express-rate-limit -> ip-address: imported only by the SDK's `server/auth/handlers/*` (auth router). Not in the stdio/McpServer import graph; no helio-mcp use -> UNREACHABLE.
- ajv -> fast-uri: `server/index.js` (imported by `server/mcp.js`, which helio-mcp uses) imports `validation/ajv-provider.js` -> REACHABLE at runtime (JSON-schema validation). Patched regardless.

## 11. Regression
```
$ jest helio-mcp/src
PASS helio-mcp/src/tools/canonicalColumnTypesDriftGuard.test.ts
PASS helio-mcp/src/hel865ConciseModes.test.ts

Test Suites: 36 passed, 36 total
Tests:       353 passed, 353 total
Snapshots:   0 total
Time:        2.564 s, estimated 58 s
Ran all test suites matching helio-mcp/src.
exit 0
$ npm run check:helio-mcp-types


> helio-mcp@0.1.0 typecheck
> tsc --noEmit -p tsconfig.typecheck.json

exit 0
$ npm --prefix helio-mcp run build

> helio-mcp@0.1.0 build
> tsc

exit 0
```
helio-mcp tests are collected by the root jest.config.cjs: 36 suites, 353 tests under helio-mcp/src (driver's ~353 figure verified).

## 12. stdio smoke (`npm run verify`) against a worktree backend
Backend pid 1608169 (java), `readlink /proc/1608169/cwd` = `<worktree>/backend` (verified). Logged in as the dev account, created PAT id `95b51296-21c3-476c-8910-8fa288e0ce56` (POST /api/tokens, needs `X-Helio-Requested-With: 1`), ran verify, revoked it (`DELETE /api/tokens/95b51296-...` -> 204; GET /api/tokens no longer lists it). Servers (java 1608169, vite 1608441) stopped by exact pid.

Result: verify exit 1, but ONLY at step `add_outputs_from_shape` setup. Everything before it passed against the live backend on the bumped dependencies: tools/list, resources/list, list_connector_types, list_data_sources, list_outputs, list_pipelines, get_pipeline, analyze_pipeline, get_output_rows, list_source_objects, list_dashboards, get_dashboard, list_pipeline_shapes. The failure is `create_pipeline` rejecting verify.ts's args with "roots: Required": helio-mcp's own tool schema (changed by HEL-913, #543) requires `roots[]` while `scripts/verify.ts` (last touched HEL-907, #507) still sends the old `source` shape. Pre-existing script/schema drift, independent of this dependency change (neither file is touched here); recorded as a spinoff candidate, not fixed here.
