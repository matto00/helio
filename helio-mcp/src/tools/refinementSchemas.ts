/**
 * Zod schemas for `apply_patch_set`'s hand-authorable `PatchSet` shape, split out of
 * `refinement.ts` for the same TS2589 ("Type instantiation is excessively deep") reason
 * `pipelineProposalValidation.ts` documents: a unit test that decodes a real payload through
 * these schemas (design.md D7 — no green typecheck is admissible consumer evidence) must not
 * also pull `refinement.ts`'s `server.registerTool(...)`/`McpServer` surface into the compile
 * graph.
 *
 * Mirrors `PatchSetProtocol.scala`'s recognized `target.kind`/`op` sets — `patch` stays an
 * untyped passthrough (`z.record(z.string(), z.unknown())`, absent for `op: "delete"`), same
 * convention `proposal.ts`'s own `panelSchema.config` already uses for a per-kind opaque
 * payload.
 *
 * HEL-914 (found during the 6b conformance sweep): `dataType` retired outright (HEL-904),
 * `output` added (HEL-907 task 1.2), and `parentId` added (task 5.1) -- all THREE were missing
 * from the pre-existing inline schema. Because zod strips unrecognized keys by default, a
 * hand-authored `target.parentId` sent through `apply_patch_set`'s `patchSet` argument was
 * SILENTLY DROPPED before ever reaching the backend -- exactly the "wire-shape break with every
 * gate green" class design.md D7 exists to catch.
 */

import { z } from "zod";

export const editTargetSchema = z.object({
  kind: z.enum(["panel", "dashboard", "dataSource", "pipeline", "pipelineStep", "output"]),
  id: z.string().optional(),
  /** HEL-914 task 5.1: names the parent resource a not-yet-existing CHILD resource is created
   *  under -- REQUIRED for a create targeting a child kind (currently only `pipelineStep`) and
   *  must be OMITTED for update/delete. */
  parentId: z.string().optional(),
});

export const editSchema = z.object({
  target: editTargetSchema,
  op: z.enum(["update", "delete", "create"]),
  patch: z.record(z.string(), z.unknown()).optional(),
});

export const patchSetSchema = z.object({
  summary: z.string().optional(),
  edits: z.array(editSchema),
});
