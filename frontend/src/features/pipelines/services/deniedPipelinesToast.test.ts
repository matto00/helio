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
  });

  it("a single denial with canRun=false carries no action", () => {
    const toast = buildDeniedPipelinesToast([{ ...aiDenial, canRun: false }], jest.fn());

    expect(toast.action).toBeUndefined();
    expect(toast.message).toMatch(/\bAI\b/);
  });

  it("N>1 denied pipelines carry no action, and the message names EVERY pipeline's specific reason", () => {
    const toast = buildDeniedPipelinesToast([aiDenial, rowsDenial], jest.fn());

    expect(toast.action).toBeUndefined();
    expect(toast.message).toMatch(/\bAI\b/);
    expect(toast.message).toMatch(/rows/i);
    expect(toast.message).toContain("Sentiment pipe");
    expect(toast.message).toContain("Big pipe");
  });

  it(
    "the message is deterministic — identical input (fresh object references) builds a " +
      "byte-identical message, independent of pipeline array order (sorted by id)",
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
