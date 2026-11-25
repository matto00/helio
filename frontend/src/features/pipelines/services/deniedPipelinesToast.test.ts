// HEL-1096 tasks.md 3.6 (design.md D3/D4, Standing Constraint C7): single denial + canRun shows
// an action; N>1 denials show no action; rapid repeated identical denials coalesce to one toast.

import { configureStore } from "@reduxjs/toolkit";

import { buildDeniedPipelinesToast } from "./deniedPipelinesToast";
import { pushToast, toastsReducer } from "../../toasts/state/toastsSlice";
import type { DeniedPipelineResponse } from "../../sources/types/dataSource";

const aiDenial: DeniedPipelineResponse = {
  pipelineId: "p1",
  name: "Sentiment pipe",
  reasons: [{ code: "ai-step", detail: "Step 's1' uses AI op 'analyzewithai'", stepId: "s1" }],
  canRun: true,
};

const rowsDenial: DeniedPipelineResponse = {
  pipelineId: "p2",
  name: "Big pipe",
  reasons: [{ code: "rows-above-threshold", detail: "Estimated 50000 rows exceeds threshold" }],
  canRun: true,
};

describe("buildDeniedPipelinesToast (HEL-1096 design.md D3)", () => {
  it("a single denial with canRun=true carries a 'Run to update' action", () => {
    const onRunToUpdate = jest.fn();
    const toast = buildDeniedPipelinesToast([aiDenial], onRunToUpdate);

    expect(toast.variant).toBe("warning");
    expect(toast.action).toBeDefined();
    expect(toast.action?.label).toBe("Run to update");
    expect(toast.duration).toBe(0);
    expect(toast.message).toMatch(/\bAI\b/);
    expect(toast.message).toContain("Sentiment pipe");

    toast.action?.onClick();
    expect(onRunToUpdate).toHaveBeenCalledTimes(1);
    // HEL-1172 D3: the callback now receives the pipeline id.
    expect(onRunToUpdate).toHaveBeenCalledWith("p1");
  });

  it("a single denial with canRun=false carries no action", () => {
    const toast = buildDeniedPipelinesToast([{ ...aiDenial, canRun: false }], jest.fn());

    expect(toast.action).toBeUndefined();
    expect(toast.message).toMatch(/\bAI\b/);
  });

  it("N>1 denied pipelines carry no toast-level action, and the message names EVERY pipeline's specific reason", () => {
    const toast = buildDeniedPipelinesToast([aiDenial, rowsDenial], jest.fn());

    expect(toast.action).toBeUndefined();
    expect(toast.message).toMatch(/\bAI\b/);
    expect(toast.message).toMatch(/rows/i);
    expect(toast.message).toContain("Sentiment pipe");
    expect(toast.message).toContain("Big pipe");
  });

  it(
    "the message is deterministic — identical input (fresh object references) builds a " +
      "byte-identical message, independent of pipeline array order (sorted by name, then id)",
    () => {
      const a = buildDeniedPipelinesToast([aiDenial, rowsDenial], jest.fn());
      const b = buildDeniedPipelinesToast(
        [
          { ...rowsDenial, reasons: [{ ...rowsDenial.reasons[0] }] },
          { ...aiDenial, reasons: [{ ...aiDenial.reasons[0] }] },
        ],
        jest.fn(),
      );

      expect(a.message).toBe(b.message);
    },
  );
});

// HEL-1172 D3 — N >= 2 denied pipelines produce per-pipeline rows (link + optional run action).
describe("buildDeniedPipelinesToast N>=2 rows (HEL-1172 D3)", () => {
  const viewerDenial: DeniedPipelineResponse = { ...rowsDenial, canRun: false };

  // HEL-1840: rewritten, not fixture drift -- the requirement changed from id order to name order
  // ("Big pipe" (p2) now precedes "Sentiment pipe" (p1)).
  it("is persistent and emits one row per pipeline in name order, even when given out of order", () => {
    const toast = buildDeniedPipelinesToast([aiDenial, rowsDenial], jest.fn());

    expect(toast.duration).toBe(0);
    expect(toast.items?.map((i) => i.key)).toEqual(["p2", "p1"]);
    expect(toast.items?.map((i) => i.linkTo)).toEqual(["/pipelines/p2", "/pipelines/p1"]);
    expect(toast.items?.map((i) => i.linkLabel)).toEqual(["Big pipe", "Sentiment pipe"]);
  });

  it("each row's text is exactly the reason text that follows 'Name: ' in the message", () => {
    const toast = buildDeniedPipelinesToast([aiDenial, rowsDenial], jest.fn());
    const lines = (toast.message ?? "").split("\n");

    expect(toast.items).toHaveLength(2);
    toast.items?.forEach((item, i) => {
      expect(item.text.length).toBeGreaterThan(0);
      expect(lines[i]).toBe(`${item.linkLabel}: ${item.text}`);
    });
  });

  it("a row has a run action only when canRun, and it runs only that pipeline", () => {
    const onRun = jest.fn();
    const toast = buildDeniedPipelinesToast([aiDenial, viewerDenial], onRun);

    // Name order: "Big pipe" (viewer, no action) then "Sentiment pipe" (canRun).
    expect(toast.items?.[0].action).toBeUndefined();
    expect(toast.items?.[1].action?.label).toBe("Run to update");
    toast.items?.[1].action?.onClick();
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith("p1");
  });

  it("is persistent even when no pipeline is runnable (every row holds a link)", () => {
    const toast = buildDeniedPipelinesToast(
      [
        { ...aiDenial, canRun: false },
        { ...rowsDenial, canRun: false },
      ],
      jest.fn(),
    );
    expect(toast.duration).toBe(0);
    expect(toast.items).toHaveLength(2);
    expect(toast.items?.every((i) => i.action === undefined)).toBe(true);
  });

  it("encodes an id with reserved characters in the link", () => {
    const toast = buildDeniedPipelinesToast(
      [{ ...aiDenial, pipelineId: "a/b c" }, rowsDenial],
      jest.fn(),
    );
    expect(toast.items?.find((i) => i.key === "a/b c")?.linkTo).toBe("/pipelines/a%2Fb%20c");
  });

  it("a single denial carries no rows", () => {
    expect(buildDeniedPipelinesToast([aiDenial], jest.fn()).items).toBeUndefined();
  });

  it("identical N>=2 pushes coalesce to one toast", () => {
    const store = configureStore({ reducer: { toasts: toastsReducer } });
    for (let i = 0; i < 3; i++) {
      store.dispatch(pushToast(buildDeniedPipelinesToast([aiDenial, rowsDenial], jest.fn())));
    }
    expect(store.getState().toasts.items).toHaveLength(1);
  });
});

// HEL-1096 Standing Constraint C7 — proves the message built above is what actually LETS
// `toastsSlice`'s existing variant+message dedup coalesce a rapid repeated identical denial into
// ONE toast, exercised through the real reducer (not re-testing the reducer's own dedup logic,
// which `toastsSlice.test.ts` already owns).
describe("rapid repeated identical denials coalesce to one toast (C7)", () => {
  function makeStore() {
    return configureStore({ reducer: { toasts: toastsReducer } });
  }

  it("dispatching the SAME denial's toast three times in a row leaves exactly one toast", () => {
    const store = makeStore();
    for (let i = 0; i < 3; i++) {
      store.dispatch(pushToast(buildDeniedPipelinesToast([aiDenial], jest.fn())));
    }
    expect(store.getState().toasts.items).toHaveLength(1);
  });

  it("a DIFFERENT denial (different pipeline) does not coalesce with the first", () => {
    const store = makeStore();
    store.dispatch(pushToast(buildDeniedPipelinesToast([aiDenial], jest.fn())));
    store.dispatch(pushToast(buildDeniedPipelinesToast([rowsDenial], jest.fn())));
    expect(store.getState().toasts.items).toHaveLength(2);
  });
});

// HEL-1840 / HEL-1844 -- rows and message are ordered by name (English, numeric-aware), then id.
describe("buildDeniedPipelinesToast name order (HEL-1840 D1)", () => {
  const denial = (pipelineId: string, name: string): DeniedPipelineResponse => ({
    pipelineId,
    name,
    reasons: [{ code: "rows-above-threshold", detail: "Estimated 50000 rows exceeds threshold" }],
    canRun: true,
  });
  // Ids deliberately sort in an order different from the names; two "Gamma"s share a name.
  const set = [
    denial("a1", "Zeta"),
    denial("b2", "alpha"),
    denial("c3", "Gamma"),
    denial("d4", "Beta"),
    denial("0e", "Gamma"),
    denial("f6", "Pipeline 10"),
    denial("g7", "Pipeline 2"),
  ];
  const expectedKeys = ["b2", "d4", "0e", "c3", "g7", "f6", "a1"];

  it("orders rows by name (case-insensitive-ish, numeric-aware), equal names by id", () => {
    const toast = buildDeniedPipelinesToast(set, jest.fn());
    expect(toast.items?.map((i) => i.key)).toEqual(expectedKeys);
  });

  it("builds the message lines in the same order as the rows", () => {
    const toast = buildDeniedPipelinesToast(set, jest.fn());
    const lines = (toast.message ?? "").split("\n");
    expect(lines.map((l) => l.split(":")[0])).toEqual(toast.items?.map((i) => i.linkLabel));
  });

  it("the same set in two input orders is byte-identical and coalesces to one toast", () => {
    const a = buildDeniedPipelinesToast(set, jest.fn());
    const b = buildDeniedPipelinesToast([...set].reverse(), jest.fn());
    expect(a.message).toBe(b.message);
    const store = configureStore({ reducer: { toasts: toastsReducer } });
    store.dispatch(pushToast(a));
    store.dispatch(pushToast(b));
    expect(store.getState().toasts.items).toHaveLength(1);
  });
});
