/** Zod shapes for output-panel controls, shared by the control tools and the proposal tools. */

import { z } from "zod";

export const controlKindSchema = z.enum(["date-range", "dropdown", "numeric-range", "text"]);

/** A control as a proposal declares it; mirrors `ProposalControl` and the backend's strict
 *  decoder (an unknown key is a 400, so `.strict()` here fails earlier and clearer). */
export const proposalControlSchema = z
  .object({
    id: z.string().min(1).optional(),
    kind: controlKindSchema,
    column: z.string().min(1),
    label: z.string().min(1).optional(),
    defaultValue: z.unknown().optional(),
  })
  .strict();

/** Documents the shared failure copy once; every value below was observed live (HEL-1193
 *  evidence-status-codes.md), not taken from a spec. */
export const CONTROL_ERROR_COPY =
  "An ineligible column/kind is rejected by the backend with HTTP 400 " +
  "`control not eligible: column '<c>', kind '<k>'` (also for an unknown column or kind), and " +
  "nothing is written; a control's eligibility is exactly the column's `controlKinds` in " +
  "get_output_filter_capabilities.";
