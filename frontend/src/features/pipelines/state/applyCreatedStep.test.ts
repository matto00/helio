import type { PipelineStep } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { applyCreatedStep } from "./applyCreatedStep";
import { OP_TYPES } from "./stepNarrowing";

const castOp = OP_TYPES.find((o) => o.id === "cast")!;

function step(id: string, over: Partial<Step> = {}): Step {
  return {
    id,
    opType: castOp,
    label: castOp.label,
    config: { casts: {} },
    enabled: true,
    position: 0,
    ...over,
  };
}

function created(id: string, over: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id,
    pipelineId: "p",
    position: 0,
    createdAt: "2026-10-06T00:00:00Z",
    updatedAt: "2026-10-06T00:00:00Z",
    type: "cast",
    config: { casts: { server: "string" } },
    enabled: true,
    ...over,
  } as PipelineStep;
}

const opts = () => ({ pendingParent: new Map<string, string>(), userRemoved: new Set<string>() });

describe("applyCreatedStep", () => {
  describe("case 1 - the created id is already present locally", () => {
    it("removes the temp, moves renderKey and config onto the present element, applies nothing else", () => {
      const local = [
        step("a", { rootId: "r" }),
        step("step-1", { config: { casts: { local: "int" } } }),
        step("n", { parentStepId: "a", config: { casts: { fromSync: "int" } } }),
        step("b", { parentStepId: "a" }),
      ];
      const o = opts();
      const out = applyCreatedStep(local, "step-1", created("n", { parentStepId: "a" }), ["b"], {
        ...o,
        renderKey: "step-1",
      });
      expect(out.map((s) => s.id)).toEqual(["a", "n", "b"]);
      const n = out.find((s) => s.id === "n")!;
      expect(n.renderKey).toBe("step-1");
      expect(n.config).toEqual({ casts: { local: "int" } });
      // reparentedStepIds is NOT applied: the wholesale sync is at least as new.
      expect(out.find((s) => s.id === "b")!.parentStepId).toBe("a");
      expect(o.pendingParent.size).toBe(0);
    });
  });

  describe("case 2 - the temp is present", () => {
    it("replaces it in place keeping local config, sets renderKey only when given", () => {
      const local = [
        step("a", { rootId: "r" }),
        step("step-1", { config: { casts: { l: "int" } } }),
      ];
      const withKey = applyCreatedStep(local, "step-1", created("n", { parentStepId: "a" }), [], {
        ...opts(),
        renderKey: "step-1",
      });
      expect(withKey[1]).toMatchObject({
        id: "n",
        parentStepId: "a",
        renderKey: "step-1",
        config: { casts: { l: "int" } },
      });
      const withoutKey = applyCreatedStep(
        local,
        "step-1",
        created("n", { parentStepId: "a" }),
        [],
        opts(),
      );
      expect(withoutKey[1].renderKey).toBeUndefined();
    });

    it("reparents listed present ids under the created step and clears rootId", () => {
      const local = [
        step("a", { rootId: "r" }),
        step("step-1"),
        step("b", { parentStepId: "a", config: { casts: { keep: "me" } } }),
        step("step-2"),
      ];
      const out = applyCreatedStep(
        local,
        "step-1",
        created("n", { parentStepId: "a" }),
        ["b"],
        opts(),
      );
      const b = out.find((s) => s.id === "b")!;
      expect(b.parentStepId).toBe("n");
      expect(b.rootId).toBeUndefined();
      expect(b.config).toEqual({ casts: { keep: "me" } });
      // other steps (a temp id included) are untouched, by reference
      expect(out.find((s) => s.id === "a")).toBe(local[0]);
      expect(out.find((s) => s.id === "step-2")).toBe(local[3]);
    });

    it("clears rootId when a root-level step is reparented (head insert)", () => {
      const local = [step("step-1"), step("a", { rootId: "r" })];
      const out = applyCreatedStep(local, "step-1", created("n", { rootId: "r" }), ["a"], opts());
      expect(out.find((s) => s.id === "a")).toMatchObject({ parentStepId: "n", rootId: undefined });
      expect(out.find((s) => s.id === "n")).toMatchObject({ rootId: "r" });
    });

    it("takes the parent from pendingParent (claimedParent) instead of the response's stale parent", () => {
      const local = [step("a", { rootId: "r" }), step("step-1")];
      const out = applyCreatedStep(local, "step-1", created("x", { parentStepId: "a" }), [], {
        ...opts(),
        claimedParent: "y",
      });
      expect(out.find((s) => s.id === "x")).toMatchObject({ parentStepId: "y", rootId: undefined });
    });

    it("records an absent listed id in pendingParent", () => {
      const o = opts();
      applyCreatedStep(
        [step("a", { rootId: "r" }), step("step-1")],
        "step-1",
        created("n", { parentStepId: "a" }),
        ["gone"],
        o,
      );
      expect(o.pendingParent.get("gone")).toBe("n");
    });

    it("chain-skip: a present R whose local chain already reaches the created id is not reparented", () => {
      // R = l sits under p2 (a LATER create) whose parent is the created id p1.
      const local = [
        step("b", { rootId: "r" }),
        step("step-1"),
        step("p2", { parentStepId: "p1" }),
        step("l", { parentStepId: "p2" }),
      ];
      const out = applyCreatedStep(
        local,
        "step-1",
        created("p1", { parentStepId: "b" }),
        ["l"],
        opts(),
      );
      expect(out.find((s) => s.id === "l")!.parentStepId).toBe("p2");
    });

    it("chain-skip also protects a pendingParent claim whose holder is already below the created id", () => {
      const o = opts();
      o.pendingParent.set("gone", "p2");
      const local = [step("step-1"), step("p2", { parentStepId: "p1" })];
      applyCreatedStep(local, "step-1", created("p1"), ["gone"], o);
      expect(o.pendingParent.get("gone")).toBe("p2");
    });

    it("unresolved chain (r6 note 1, option b): a chain through an absent step that does not reach the created id is applied", () => {
      const local = [step("step-1"), step("l", { parentStepId: "absent-step" })];
      const out = applyCreatedStep(local, "step-1", created("n"), ["l"], opts());
      expect(out.find((s) => s.id === "l")!.parentStepId).toBe("n");
    });

    it("reverse commit order: later create's response first, then the earlier one, ends A->Y->X->B", () => {
      // Server: X then Y committed after A; Y's response reparents [X], X's reparents [B].
      let local = [
        step("a", { rootId: "r" }),
        step("t-x"),
        step("t-y"),
        step("b", { parentStepId: "a" }),
      ];
      const o = opts();
      // Y's response arrives first: X is still a temp, so X's reparent is recorded.
      local = applyCreatedStep(local, "t-y", created("Y", { parentStepId: "a" }), ["X"], o);
      expect(o.pendingParent.get("X")).toBe("Y");
      // X's response: its stale parent "a" is overridden by the claim.
      const claimed = o.pendingParent.get("X");
      o.pendingParent.delete("X");
      local = applyCreatedStep(local, "t-x", created("X", { parentStepId: "a" }), ["b"], {
        ...o,
        claimedParent: claimed,
      });
      const parent = (id: string) => local.find((s) => s.id === id)!.parentStepId;
      expect(parent("Y")).toBe("a");
      expect(parent("X")).toBe("Y");
      expect(parent("b")).toBe("X");
    });
  });

  describe("case 3 - the temp is absent", () => {
    it("appends the created step and applies the listed ids when the user did not remove it", () => {
      const local = [step("a", { rootId: "r" }), step("b", { parentStepId: "a" })];
      const out = applyCreatedStep(local, "step-9", created("n", { parentStepId: "a" }), ["b"], {
        ...opts(),
        renderKey: "step-9",
      });
      expect(out.map((s) => s.id)).toEqual(["a", "b", "n"]);
      expect(out.find((s) => s.id === "b")!.parentStepId).toBe("n");
      expect(out.find((s) => s.id === "n")!.renderKey).toBe("step-9");
    });

    it("is a no-op when the user removed the temp", () => {
      const local = [step("a", { rootId: "r" })];
      const out = applyCreatedStep(local, "step-9", created("n"), ["a"], {
        pendingParent: new Map(),
        userRemoved: new Set(["step-9"]),
      });
      expect(out).toBe(local);
    });
  });
});
