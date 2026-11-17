import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { sourceSamplesReducer } from "../../sources/state/sourceSamplesSlice";
import { createDraftFrameMemory, usePipelineDraftFrames } from "./usePipelineDraftFrames";
import { postDraftPreview } from "../services/draftPreviewClient";
import { chunkedResponse } from "../services/draftPreviewTestSupport";
import type { DraftPreviewRequest } from "../types/draftPreview";
import type { Step } from "../types/step";

jest.mock("../services/draftPreviewClient", () => ({
  ...jest.requireActual("../services/draftPreviewClient"),
  postDraftPreview: jest.fn(),
}));
const post = jest.mocked(postDraftPreview);

// HEL-1705 (D): a server-resolved Output whose step is not the selected one must refresh from the same request. This fake
// server answers the way the fixed endpoint does: one `rows` line for `rowsStepId`, then one per further `rowsStepIds` id.
function fakeServer(request: DraftPreviewRequest): Response {
  const ids = [request.rowsStepId, ...((request as { rowsStepIds?: string[] }).rowsStepIds ?? [])];
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
  const lines = [
    ...request.steps.map((s) => ({ type: "step", step: s.id, count: 1, schema: [] })),
    ...wanted.map((step) => ({
      type: "rows",
      step,
      available: true,
      rows: [{ n: { $int: 1 } }],
      count: 1,
      truncated: false,
    })),
  ];
  return chunkedResponse([lines.map((l) => JSON.stringify(l)).join("\n") + "\n"]);
}

const op = (id: string) => ({ id, label: id, icon: (() => null) as never });
const step = (id: string, kind: string, parent: string | null, config: object): Step => ({
  id,
  opType: op(kind),
  label: id,
  config: config as Step["config"],
  enabled: true,
  parentStepId: parent,
  position: 0,
  rootId: parent === null ? "r1" : undefined,
});

function store() {
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

describe("an unfocused server-resolved Output (HEL-1705 D)", () => {
  beforeEach(() => {
    post.mockReset();
    post.mockImplementation((_id, request) => Promise.resolve(fakeServer(request)));
  });

  it("gets its rows from the one request, while another step is focused", async () => {
    const steps = [
      step("s1", "convertformat", null, { field: "n", from: "csv", to: "json" }),
      step("s2", "limit", "s1", { count: 1 }),
    ];
    const reduxStore = store();
    const memory = createDraftFrameMemory();
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={reduxStore}>{children}</Provider>
    );
    // The layout names the displayed Output's node (stable identity, as `useDisplayedOutputNodeIds` returns it).
    const outputNodeStepIds = ["s2"];
    const { result } = renderHook(
      () =>
        usePipelineDraftFrames({
          pipelineId: "p1",
          roots: [{ id: "r1", dataSourceId: "src", dataSourceName: "src" }],
          baseSteps: steps,
          draftSteps: steps,
          hasDraft: true,
          focusStepId: "s1",
          memory,
          outputNodeStepIds,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.views?.get("s1")?.status).toBe("ok"), {
      timeout: 3000,
    });
    const s2 = result.current.views?.get("s2");
    expect(s2?.rows).not.toBeNull();
    expect(s2?.frameStale).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
  });

  // HEL-1705 C5: the displayed Output adds no request. One paced request carries every rows line.
  describe("request count", () => {
    const edit = (i: number): Step[] => [
      step("s1", "convertformat", null, {
        field: "n",
        from: "csv",
        to: "json",
        outputField: `o${i}`,
      }),
      step("s2", "limit", "s1", { count: 1 }),
    ];

    /** Ten edits 100 ms apart (a second, so the scheduler paces several sends), then the clock runs out; returns the requests sent. */
    async function burst(idsAt: (edit: number) => readonly string[]): Promise<number> {
      jest.useFakeTimers();
      try {
        post.mockClear();
        const reduxStore = store();
        const memory = createDraftFrameMemory();
        const wrapper = ({ children }: PropsWithChildren) => (
          <Provider store={reduxStore}>{children}</Provider>
        );
        const useFrames = (i: number) =>
          usePipelineDraftFrames({
            pipelineId: "p1",
            roots: [{ id: "r1", dataSourceId: "src", dataSourceName: "src" }],
            baseSteps: edit(0),
            draftSteps: edit(i),
            hasDraft: true,
            focusStepId: "s1",
            memory,
            outputNodeStepIds: idsAt(i),
          });
        const { rerender } = renderHook(({ i }) => useFrames(i), {
          wrapper,
          initialProps: { i: 0 },
        });
        for (let i = 1; i <= 10; i += 1) {
          rerender({ i });
          await act(async () => {
            jest.advanceTimersByTime(100);
          });
        }
        for (let t = 0; t < 10; t += 1) {
          await act(async () => {
            jest.advanceTimersByTime(1000);
          });
        }
        return post.mock.calls.length;
      } finally {
        jest.useRealTimers();
      }
    }

    // Stable identities, as `useDisplayedOutputNodeIds` returns them.
    const NONE: readonly string[] = [];
    const S2: readonly string[] = ["s2"];

    it("sends exactly as many requests with a non-focus Output displayed as with none, and a mid-burst switch adds at most one", async () => {
      const without = await burst(() => NONE);
      const withOutput = await burst(() => S2);
      const switched = await burst((i) => (i < 5 ? NONE : S2));
      expect(without).toBeGreaterThan(0);
      expect(withOutput).toBe(without);
      expect(switched).toBeLessThanOrEqual(without + 1);
    });
  });
});
