import { stampFingerprints } from "./stampFingerprints";
import type { PatchSet, PatchSetPreviewResponse } from "../types/patchSet";

const patchSet: PatchSet = {
  summary: "s",
  edits: [
    { target: { kind: "panel", id: "p1" }, op: "update", patch: { title: "T" } },
    { target: { kind: "pipelineStep", id: "s1" }, op: "delete" },
    { target: { kind: "panel" }, op: "create", patch: { type: "divider" } },
  ],
};

const preview: PatchSetPreviewResponse = {
  edits: [
    { index: 0, kind: "panel", op: "update", impact: [], fingerprint: "v1:a" },
    { index: 1, kind: "pipelineStep", op: "delete", impact: [], fingerprint: "v1:b" },
    { index: 2, kind: "panel", op: "create", impact: [] },
  ],
};

describe("stampFingerprints", () => {
  it("copies each update and delete entry's fingerprint onto the matching target", () => {
    const stamped = stampFingerprints(patchSet, preview);
    expect(stamped.edits[0].target).toEqual({ kind: "panel", id: "p1", fingerprint: "v1:a" });
    expect(stamped.edits[1].target).toEqual({
      kind: "pipelineStep",
      id: "s1",
      fingerprint: "v1:b",
    });
  });

  it("leaves a create target without a fingerprint", () => {
    expect(stampFingerprints(patchSet, preview).edits[2].target).toEqual({ kind: "panel" });
  });

  it("replaces a fingerprint that arrived with the patch set by the previewed one", () => {
    const incoming: PatchSet = {
      edits: [
        { target: { kind: "panel", id: "p1", fingerprint: "v1:old" }, op: "update", patch: {} },
      ],
    };
    expect(stampFingerprints(incoming, preview).edits[0].target.fingerprint).toBe("v1:a");
  });

  it("drops an incoming fingerprint when the preview issued none", () => {
    const incoming: PatchSet = {
      edits: [
        { target: { kind: "panel", id: "p1", fingerprint: "v1:old" }, op: "update", patch: {} },
      ],
    };
    const noFingerprints: PatchSetPreviewResponse = {
      edits: [{ index: 0, kind: "panel", op: "update", impact: [] }],
    };
    expect(stampFingerprints(incoming, noFingerprints).edits[0].target).toEqual({
      kind: "panel",
      id: "p1",
    });
  });

  it("does not mutate the patch set it was given", () => {
    const copy = JSON.parse(JSON.stringify(patchSet));
    stampFingerprints(patchSet, preview);
    expect(patchSet).toEqual(copy);
  });
});
