/**
 * Zod schema for `create_connector` (HEL-886 design.md Decisions 1-4) — creates
 * credential-less Connectors only (`authType: "none"`). Split into its own module for the
 * same reason `restDataSourceSchema.ts` is (HEL-828): a unit test can import just this
 * narrow surface without pulling `write.ts`'s full Zod-schema surface into the compile
 * graph.
 *
 * Unrecognized-key rejection is plain `.strict(MSG)` — a fixed message naming the `/connectors`
 * out-of-band path (skeptic-final-2.md, coordinator-approved concession recorded in
 * `specs/mcp-data-source-tools/spec.md`). An earlier revision (skeptic-final-1.md CR1) tried
 * `.passthrough()` + a `.superRefine` walking the parsed value's own keys, specifically so the
 * message could ALSO name the offending key -- `.strict()`'s message param is a fixed string
 * that structurally cannot interpolate it. That mechanism regressed the boundary in three ways,
 * reproduced live by skeptic-final-2.md against a running MCP server, none of which existed
 * under plain `.strict()`:
 *   1. `.passthrough()` assigns unknown keys onto a fresh output object; assigning `"__proto__"`
 *      sets the prototype rather than creating an own key, so `Object.keys(value)` never saw it
 *      -- a `__proto__` payload was silently ACCEPTED and the tool went on to call the backend.
 *   2. `write.ts` registers this schema directly as a tool's `inputSchema`; the MCP SDK's
 *      `normalizeObjectSchema` only unwraps a `ZodObject` (via its `.shape`), not a `ZodEffects`
 *      (what `.superRefine` produces) -- `create_connector` advertised an EMPTY JSON Schema
 *      (`{"type":"object","properties":{}}`) to every client calling `listTools()`, silently
 *      losing the required-field/denylist-field advertisement `create_rest_data_source` still
 *      carries. Runtime enforcement still held (the SDK falls back to the raw schema when
 *      normalization returns `undefined`), so this was a discoverability/contract defect, not a
 *      security hole -- but a real, shipped, client-visible one.
 *   3. Zod aborts a `ZodEffects` refinement when the INNER object parse already produced a hard
 *      issue (e.g. a missing `baseUrl`), so the `superRefine` never ran -- a partially-malformed
 *      call carrying an unrecognized key (the realistic shape of an agent's first guess) reported
 *      ONLY the other field's error, silently dropping the unrecognized-key message `.strict()`
 *      itself always reported alongside other field errors.
 * The concession: the spec's "naming BOTH the offending key and the out-of-band path IN THE
 * MESSAGE" was narrowed to "identifying the offending key in the message OR the issue payload" --
 * `.strict()`'s issue always carries the unrecognized key(s) on `issue.keys`, even though the
 * `message` string itself is fixed. `restDataSourceSchema.ts`'s `.strict()` is deliberately left
 * alone -- its own spec text makes no equivalent promise, so touching its mechanism too would be
 * an unrequested, out-of-scope change.
 *
 * No `defaultHeaders` input (Decision 4): `ConnectorAuthShape` supports it, but a free-form
 * header map is a credential-shaped channel (`Authorization: Bearer …`). Omitting it is a
 * tightening relative to what the backend would allow, not a claim that the whole MCP surface
 * is airtight — see design.md Decision 4/Risks for the pre-existing `headers` channel on
 * `create_rest_data_source`, which this change does not touch.
 *
 * `authType` is an accepted *input* (Decision 2) so a credentialed-host request has somewhere
 * to land: the handler (`connectorHandlers.ts`) refuses anything other than `"none"` BEFORE any
 * HTTP call, with prose naming the in-app `/connectors` page — never a bare Zod enum error.
 * `authType` is deliberately a free-form `z.string()`, NOT `z.enum(["none","bearer","api_key"])`
 * (evaluation-1.md CR1): an enum makes every value OUTSIDE the three predicted ones die at a
 * bare Zod "Invalid enum value" error before the handler ever runs, reproducing exactly the
 * "bare validation error" AC3/the spec delta rule out -- for the general case, not just the two
 * predicted bad values. Widening the type means EVERY non-"none" value (predicted or not)
 * reaches the same actionable refusal, proven by `connectorHandlers.test.ts` to make zero HTTP
 * calls regardless of which string was supplied.
 */

import { z } from "zod";
import { rejectCredentialField } from "./credentialDenylist.js";

const CREDENTIAL_REJECT_OPTS = {
  toolName: "create_connector",
  alternative:
    "create_connector only creates unauthenticated (authType: none) Connectors — a " +
    "credentialed host is completed by a human at the in-app /connectors page.",
};

export const createConnectorInputSchema = {
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  kind: z.string().min(1).optional(),
  authType: z.string().min(1).optional(),
  // Explicit, always-rejecting fields (Decision 3, shared mechanism with
  // create_rest_data_source) — loud, not silent, naming the /connectors out-of-band path.
  auth: rejectCredentialField("auth", CREDENTIAL_REJECT_OPTS),
  apiKey: rejectCredentialField("apiKey", CREDENTIAL_REJECT_OPTS),
  token: rejectCredentialField("token", CREDENTIAL_REJECT_OPTS),
  password: rejectCredentialField("password", CREDENTIAL_REJECT_OPTS),
  credential: rejectCredentialField("credential", CREDENTIAL_REJECT_OPTS),
};

/** Fixed unrecognized-key message (`.strict()`'s message param cannot interpolate which key --
 *  see file header). Zod still carries the actual offending key(s) on `issue.keys`, which is
 *  where the spec's concession says the identification may live. */
const UNRECOGNIZED_KEY_MESSAGE = `An unrecognized field is not accepted by create_connector — ${CREDENTIAL_REJECT_OPTS.alternative}`;

// .strict(MSG) (skeptic-final-2.md): stays a plain ZodObject (correct JSON Schema advertisement,
// no .passthrough()-onto-__proto__ hole, and the check fires unconditionally alongside any other
// field error -- none of which a .superRefine-based replacement preserved). The five named
// denylist fields above still give a BETTER, key-specific message than this fallback, since a
// known key reaches its own `.refine` before the unrecognized-key check runs.
export const createConnectorSchema = z
  .object(createConnectorInputSchema)
  .strict(UNRECOGNIZED_KEY_MESSAGE);
