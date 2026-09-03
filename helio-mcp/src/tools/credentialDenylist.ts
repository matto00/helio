/**
 * Shared credential-denylist primitive (HEL-886 design.md Decision 3), extracted from
 * `restDataSourceSchema.ts` (HEL-828) so `connectorSchema.ts` can reuse the exact same
 * always-rejecting-field mechanism without duplicating it.
 *
 * Two things vary across call sites, not one: the **tool name** and the **correct
 * alternative** a caller should use instead. `rejectCredentialField` therefore takes both
 * as parameters, so `create_rest_data_source`'s message stays byte-identical to what it
 * was before this extraction (by construction, not by accident), while `create_connector`
 * can name a different alternative (`/connectors`, the out-of-band path) for the same
 * mechanism.
 */

import { z } from "zod";

/** A field that is always rejected when present (any type never survives past `undefined`) —
 *  never merely stripped. The error message names `toolName` and `alternative` explicitly. */
export function rejectCredentialField(
  field: string,
  opts: { toolName: string; alternative: string },
) {
  return z
    .any()
    .optional()
    .refine((value) => value === undefined, {
      message:
        `${field} is not accepted by ${opts.toolName} — credentials live on the ` +
        `referenced Connector, never on this call. ${opts.alternative}`,
    });
}
