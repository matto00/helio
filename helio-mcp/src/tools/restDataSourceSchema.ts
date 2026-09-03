/**
 * Zod schema for `create_rest_data_source` (`write.ts`), split into its own small module —
 * mirrors `metricSchemas.ts`'s extraction precedent — so a unit test can import just this
 * narrow surface without pulling `write.ts`'s full ~20-tool Zod-schema surface into the
 * compile graph (pathologically expensive under this repo's root `tsconfig.json`/ts-jest
 * combination — see `write.test.ts`).
 *
 * HEL-828 design.md Decision 4: this schema carries NO `url`/credential field that is ever
 * forwarded to the backend — `connectorId` is required, everything else is an optional
 * REST-request shaping field. The exported schema is `.strict()` (skeptic-final-1.md round 1):
 * ANY unrecognized key — not just the 5 named ones below — fails the parse, so a caller
 * instructed to "pass the API key inline" has nowhere to put it, under any name, and a bare
 * `url` is rejected rather than silently discarded.
 *
 * Evaluation-1.md (cycle 2): a caller instructed to "pass the API key inline" doesn't merely
 * get silently ignored — `auth`/`apiKey`/`token`/`password`/`credential` are explicit,
 * always-rejecting fields on this schema, so the tool call FAILS LOUDLY with a message naming
 * `connectorId` as the correct way to supply credentials. Silently stripping an unrecognized
 * key (Zod's default `z.object` behavior) would let an agent believe it configured auth when
 * it did not, and the source would silently fail to authenticate later, far from the actual
 * mistake — the same defect class as HEL-843's `jsonPath` silent-failure bug. These 5 named
 * refines are kept even under `.strict()` (a known key still reaches its own `.refine` before
 * the unknown-key check runs) because they give a better, connectorId-naming error message than
 * `.strict()`'s generic "unrecognized key" error would for the obvious names.
 */

import { z } from "zod";
import { rejectCredentialField } from "./credentialDenylist.js";

const CREDENTIAL_REJECT_OPTS = {
  toolName: "create_rest_data_source",
  alternative: "Pass connectorId instead.",
};

export const createRestDataSourceInputSchema = {
  name: z.string().min(1),
  connectorId: z
    .string({
      required_error:
        "connectorId is required — call list_connectors to obtain one, or create_connector " +
        "if none exist yet.",
    })
    .min(1, {
      message:
        "connectorId is required — call list_connectors to obtain one, or create_connector " +
        "if none exist yet.",
    }),
  endpoint: z.string().optional(),
  method: z.string().optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  bodyContentType: z.string().optional(),
  rootSelector: z.string().optional(),
  // Explicit, always-rejecting fields (evaluation-1.md cycle 2) — loud, not silent, with a
  // connectorId-naming message better than .strict()'s generic unrecognized-key error.
  auth: rejectCredentialField("auth", CREDENTIAL_REJECT_OPTS),
  apiKey: rejectCredentialField("apiKey", CREDENTIAL_REJECT_OPTS),
  token: rejectCredentialField("token", CREDENTIAL_REJECT_OPTS),
  password: rejectCredentialField("password", CREDENTIAL_REJECT_OPTS),
  credential: rejectCredentialField("credential", CREDENTIAL_REJECT_OPTS),
};

// .strict() (skeptic-final-1.md round 1): closes the gap the 5-name denylist above leaves open
// — an unlisted credential-shaped key (e.g. secret/bearer/authorization/apiSecret/accessToken)
// or a bare url is now rejected too, not silently dropped.
export const createRestDataSourceSchema = z.object(createRestDataSourceInputSchema).strict();
