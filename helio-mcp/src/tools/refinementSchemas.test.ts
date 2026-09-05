/**
 * HEL-914 (found during the 6b conformance sweep): decode tests for `apply_patch_set`'s
 * hand-authorable `PatchSet` shape (design.md D7 — no green typecheck is admissible consumer
 * evidence). Before this fix, `editTargetSchema` had no `parentId` field at all — since zod
 * strips unrecognized keys by default, a hand-authored `target.parentId` would have been
 * SILENTLY DROPPED by `patchSetSchema.parse`, never reaching the backend. `kind` also still
 * carried the retired `dataType` and omitted `output`.
 */

import { patchSetSchema } from "./refinementSchemas.js";

describe("patchSetSchema (apply_patch_set's hand-authorable PatchSet shape)", () => {
  it("decodes a pipelineStep create edit, preserving target.parentId and patch.attachAsTail", () => {
    const raw = {
      summary: "Add a lane",
      edits: [
        {
          target: { kind: "pipelineStep", parentId: "pipeline-1" },
          op: "create",
          patch: {
            type: "limit",
            config: { count: 5 },
            parentStepId: "step-1",
            attachAsTail: true,
          },
        },
      ],
    };

    const parsed = patchSetSchema.parse(raw);
    const edit = parsed.edits[0]!;

    expect(edit.target.parentId).toBe("pipeline-1");
    expect(edit.patch?.attachAsTail).toBe(true);
  });

  it("decodes every real target.kind the backend accepts, including output (previously missing)", () => {
    for (const kind of ["panel", "dashboard", "dataSource", "pipeline", "pipelineStep", "output"]) {
      const raw = { edits: [{ target: { kind, id: "res-1" }, op: "update", patch: {} }] };
      expect(() => patchSetSchema.parse(raw)).not.toThrow();
    }
  });

  it("rejects the retired dataType kind, which no longer names a real resource", () => {
    const raw = { edits: [{ target: { kind: "dataType", id: "dt-1" }, op: "update" }] };
    expect(() => patchSetSchema.parse(raw)).toThrow();
  });

  it("decodes an update edit with no parentId, populating it as undefined (never required)", () => {
    const raw = {
      edits: [{ target: { kind: "panel", id: "panel-1" }, op: "update", patch: { title: "x" } }],
    };
    const parsed = patchSetSchema.parse(raw);
    expect(parsed.edits[0]!.target.parentId).toBeUndefined();
  });
});
