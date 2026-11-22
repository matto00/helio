import { configureStore } from "@reduxjs/toolkit";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { sourceSamplesReducer } from "../../sources/state/sourceSamplesSlice";
import { evaluatePipeline } from "../evaluator";
import { createDraftFrameMemory, usePipelineDraftFrames } from "./usePipelineDraftFrames";
import type { Step } from "../types/step";

jest.mock("../evaluator", () => {
  const actual = jest.requireActual("../evaluator");
  return { ...actual, evaluatePipeline: jest.fn(actual.evaluatePipeline) };
});
jest.mock("../services/draftPreviewClient", () => ({
  ...jest.requireActual("../services/draftPreviewClient"),
  postDraftPreview: jest.fn(),
}));
const walk = jest.mocked(evaluatePipeline);

// HEL-1809 (design.md D3/D5 i): the saved side of the draft walk. Rendered WITHOUT StrictMode, so a memo factory runs once per
// real recomputation. A call is a SAVED walk when it walks the saved step (limit count SAVED_COUNT); a draft edit uses other counts.
const SAVED_COUNT = 1;

const limit = (count: number): Step[] => [
  {
    id: "s1",
    opType: { id: "limit", label: "limit", icon: (() => null) as never },
    label: "s1",
    config: { count } as Step["config"],
    enabled: true,
    parentStepId: null,
    position: 0,
    rootId: "r1",
  },
];

const savedWalks = () =>
  walk.mock.calls.filter(([defs]) => (defs[0]?.config as { count?: number }).count === SAVED_COUNT)
    .length;

function reduxStore() {
  return configureStore({
    reducer: { sourceSamples: sourceSamplesReducer },
    preloadedState: {
      sourceSamples: {
        epoch: 0,
        entries: {
          src: {
            status: "ready" as const,
            requestedAt: 0,
            sample: {
              rows: [{ n: 1 }, { n: 2 }],
              capturedAt: "",
              sourceRowCount: 2,
              truncated: false,
              live: false,
            },
          },
        },
      },
    },
  });
}

const ROOTS = [{ id: "r1", dataSourceId: "src", dataSourceName: "src" }];

function setup(initial: { baseSteps: Step[]; draftSteps: Step[]; hasDraft: boolean }) {
  const store = reduxStore();
  const memory = createDraftFrameMemory();
  const wrapper = ({ children }: PropsWithChildren) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook(
    (props: { baseSteps: Step[]; draftSteps: Step[]; hasDraft: boolean }) =>
      usePipelineDraftFrames({
        pipelineId: "p1",
        roots: ROOTS,
        baseSteps: props.baseSteps,
        draftSteps: props.draftSteps,
        hasDraft: props.hasDraft,
        focusStepId: "s1",
        memory,
      }),
    { wrapper, initialProps: initial },
  );
}

describe("the saved walk of usePipelineDraftFrames (HEL-1809)", () => {
  beforeEach(() => walk.mockClear());

  it("walks the saved steps once for a first edit and not again for later draft-only edits", () => {
    const baseSteps = limit(SAVED_COUNT);
    const { rerender } = setup({ baseSteps, draftSteps: baseSteps, hasDraft: false });
    expect(savedWalks()).toBe(0);

    rerender({ baseSteps, draftSteps: limit(2), hasDraft: true });
    expect(savedWalks()).toBe(1);

    rerender({ baseSteps, draftSteps: limit(3), hasDraft: true });
    rerender({ baseSteps, draftSteps: limit(4), hasDraft: true });
    rerender({ baseSteps, draftSteps: limit(5), hasDraft: true });
    expect(savedWalks()).toBe(1);
  });

  it("walks the saved steps again when the saved steps themselves change", () => {
    const baseSteps = limit(SAVED_COUNT);
    const { rerender } = setup({ baseSteps, draftSteps: limit(2), hasDraft: true });
    expect(savedWalks()).toBe(1);

    rerender({ baseSteps: limit(SAVED_COUNT), draftSteps: limit(2), hasDraft: true });
    expect(savedWalks()).toBe(2);
  });
});
