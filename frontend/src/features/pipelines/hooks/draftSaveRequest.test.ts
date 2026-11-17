// HEL-1704 characterization GUARDS (not red-first): they pin what `usePipelineDraftSave.post` did inline before it was split
// into `buildDraftSaveRequest` / `noticeForSaveError`. Mutations recorded in evidence.md.

import { AxiosError } from "axios";

import type { DraftOp } from "../state/draftOps";
import { EMPTY_OVERLAY, type DraftOverlay } from "../state/pipelineDraft";
import { pipelineStepToStep } from "../state/stepNarrowing";
import type { Output } from "../types/output";
import { makeOutput, threeSteps } from "../ui/pipelineSpineTestKit";
import { buildDraftSaveRequest, noticeForSaveError, stepNamedBy } from "./draftSaveRequest";

const wire = threeSteps();
const steps = wire.map(pipelineStepToStep);
const FINGERPRINT = "v1:" + "a".repeat(64);
const summary = { fingerprint: FINGERPRINT, definition: { steps: wire, outputs: [] } };

function build(over: Partial<Parameters<typeof buildDraftSaveRequest>[0]> = {}) {
  return buildDraftSaveRequest({
    summary,
    persistedSteps: steps,
    baseOutputs: null,
    overlay: EMPTY_OVERLAY,
    roots: [],
    confirm: undefined,
    ...over,
  });
}

function axiosError(data: unknown) {
  return new AxiosError("x", "ERR", undefined, undefined, {
    status: 422,
    data,
  } as never);
}

describe("[guard] buildDraftSaveRequest", () => {
  it("is unreadable without a definition or a fingerprint", () => {
    expect(build({ summary: { fingerprint: FINGERPRINT } })).toEqual({ kind: "unreadable" });
    expect(build({ summary: { definition: summary.definition } })).toEqual({ kind: "unreadable" });
  });

  it("is stale when the saved definition no longer matches the draft's base", () => {
    expect(build({ persistedSteps: steps.slice(1) })).toEqual({ kind: "stale" });
  });

  it("is dropped, with the count, when an op no longer applies", () => {
    const overlay = {
      ...EMPTY_OVERLAY,
      ops: [
        {
          kind: "insert" as const,
          clientId: "draft-1",
          type: "limit" as const,
          config: { count: 1 },
          anchor: { after: "gone" },
        },
      ],
    };
    expect(build({ overlay })).toEqual({ kind: "dropped", count: 1 });
  });

  it("is ready with a run-after-save request carrying the base fingerprint and the cascade confirmation", () => {
    const confirm = { stepIds: ["s"], outputIds: [], panelIds: [], alertRuleIds: [] };
    const built = build({ confirm });
    expect(built.kind).toBe("ready");
    if (built.kind !== "ready") return;
    expect(built.request.baseFingerprint).toBe(FINGERPRINT);
    expect(built.request.runAfterSave).toBe("run");
    expect(built.request.confirmCascade).toEqual(confirm);
    const plain = build();
    expect(plain.kind === "ready" && "confirmCascade" in plain.request).toBe(false);
  });
});

describe("[guard] noticeForSaveError", () => {
  const ctx = { steps, outputs: [], draftSteps: steps };

  it("maps a stale conflict to the stale notice", () => {
    const err = axiosError({ code: "PATCH_SET_STALE", staleTargets: [] });
    expect(noticeForSaveError(err, ctx)).toEqual({ notice: { kind: "stale" } });
  });

  it("maps a cascade-required 422 to a prompt naming steps and falling back for unknown ids", () => {
    const err = axiosError({
      code: "CASCADE_CONFIRMATION_REQUIRED",
      impact: { stepIds: [steps[0].id, "zz"], outputIds: ["o-9"] },
    });
    const mapped = noticeForSaveError(err, ctx);
    expect("cascade" in mapped).toBe(true);
    if (!("cascade" in mapped)) return;
    expect(mapped.cascade.stepNames).toEqual([steps[0].label, "A step"]);
    expect(mapped.cascade.outputNames).toEqual(["An Output"]);
  });

  it("maps anything else to an error notice naming the step the message mentions", () => {
    const err = new Error("boom");
    expect(noticeForSaveError(err, ctx)).toEqual({
      notice: { kind: "error", message: "The save could not be completed.", stepName: null },
    });
    const named = axiosError({ message: `bad ${steps[1].id}` });
    const mapped = noticeForSaveError(named, ctx);
    expect("notice" in mapped && mapped.notice.kind === "error" && mapped.notice.stepName).toBe(
      steps[1].label,
    );
  });
});

// HEL-1733 (design.md D9): the save body carries the replayed Outputs. Red first against the pre-change builder, which emitted the
// saved Outputs only (`toDraftOutputs(definition.outputs, ...)`) and never an edit, a created Output or a delete.
describe("buildDraftSaveRequest with draft Outputs (HEL-1733)", () => {
  const saved = makeOutput("o1", "Saved", { nodeStepId: "s2" });
  const withOutputs = { fingerprint: FINGERPRINT, definition: { steps: wire, outputs: [saved] } };
  const buildWith = (overlay: DraftOverlay, outputs: Output[] | null = [saved]) =>
    build({ summary: withOutputs, baseOutputs: outputs, overlay });
  const create = (clientId: string, node: string, name = "New"): DraftOp => ({
    kind: "outputCreate",
    clientId,
    node: { step: node },
    outputKind: "table",
    name,
    config: {},
  });

  it("emits a created Output by clientId on a saved step, and an edit and a delete as the draft shows them", () => {
    const edited = buildWith({
      ...EMPTY_OVERLAY,
      ops: [create("draft-o", "s1")],
      outputEdits: { o1: { name: "Renamed", config: { a: 1 } } },
    });
    expect(edited.kind === "ready" && edited.request.outputs).toEqual([
      { id: "o1", name: "Renamed", kind: "table", config: { a: 1 }, nodeStepId: "s2" },
      { clientId: "draft-o", name: "New", kind: "table", config: {}, nodeStepId: "s1" },
    ]);
    const deleted = buildWith({
      ...EMPTY_OVERLAY,
      ops: [{ kind: "outputDelete", outputId: "o1" }],
    });
    expect(deleted.kind === "ready" && deleted.request.outputs).toEqual([]);
  });

  it("names a step the draft created by nodeStepClientId", () => {
    const built = buildWith({
      ...EMPTY_OVERLAY,
      ops: [
        {
          kind: "insert",
          clientId: "draft-s",
          type: "limit",
          config: { count: 1 },
          anchor: { after: "s3" },
        },
        create("draft-o", "draft-s"),
      ],
    });
    expect(built.kind === "ready" && built.request.outputs[1]).toMatchObject({
      clientId: "draft-o",
      nodeStepClientId: "draft-s",
    });
    expect(built.kind === "ready" && built.request.outputs[1].nodeStepId).toBeUndefined();
  });

  it("sends nothing when an Output op no longer applies (dropped), never a reduced list", () => {
    const built = buildWith({ ...EMPTY_OVERLAY, ops: [create("draft-o", "gone")] });
    expect(built).toEqual({ kind: "dropped", count: 1 });
  });

  it("is stale when the saved Outputs differ from the draft's base Outputs", () => {
    expect(buildWith({ ...EMPTY_OVERLAY }, [makeOutput("o9", "Other")])).toEqual({ kind: "stale" });
  });
});

describe("stepNamedBy names a created Output from a 400 (HEL-1733 D9)", () => {
  it("returns the Output's name when only its client id appears in the message", () => {
    const created = makeOutput("draft-abc123", "My new output");
    expect(stepNamedBy("Output 'draft-abc123': unknown key", steps, [created])).toBe(
      "My new output",
    );
    expect(stepNamedBy("nothing here", steps, [created])).toBeNull();
  });
});
