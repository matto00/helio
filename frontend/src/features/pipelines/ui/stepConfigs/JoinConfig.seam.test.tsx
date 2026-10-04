// HEL-958 seam test, frontend half. `shared-test-fixtures/join-step-config.json` holds the exact
// config object the join editor persists; the backend half (`JoinStepConfigSeamSpec`) decodes and
// round-trips the SAME file. This drives the real editor (`StepOpEditor` + `useStepCardState`) with
// `updatePipelineStep` mocked and asserts the PATCH body equals each fixture case with an exact key
// set, so a key renamed in the persist payload fails here.

import { act, fireEvent, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import { renderWithStore } from "../../../../test/renderWithStore";
import { updatePipelineStep } from "../../services/pipelineService";
import { useStepCardState } from "../../hooks/useStepCardState";
import { OP_TYPES } from "../../state/stepNarrowing";
import type { PipelineStep } from "../../types/pipelineStep";
import type { Step } from "../../types/step";
import { StepOpEditor } from "../StepOpEditor";

jest.mock("../../services/pipelineService", () => ({
  updatePipelineStep: jest.fn(),
}));
const updatePipelineStepMock = jest.mocked(updatePipelineStep);

interface JoinFixtureConfig {
  secondaryInput: { kind: "source"; dataSourceId: string } | { kind: "lane"; stepId: string };
  joinKey: string;
  joinType: string;
}

function findRepoRoot(dir: string): string {
  return fs.existsSync(path.join(dir, "shared-test-fixtures"))
    ? dir
    : findRepoRoot(path.dirname(dir));
}

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(findRepoRoot(__dirname), "shared-test-fixtures/join-step-config.json"),
    "utf8",
  ),
) as { cases: { source: JoinFixtureConfig; lane: JoinFixtureConfig } };

const JOIN_OP = OP_TYPES.find((op) => op.id === "join")!;
const FILTER_OP = OP_TYPES.find((op) => op.id === "filter")!;

const SEED_CONFIG = {
  secondaryInput: { kind: "source", dataSourceId: "" },
  joinKey: "",
  joinType: "inner",
};

const joinStep: Step = {
  id: "persisted-join-1",
  opType: JOIN_OP,
  label: "Join tables",
  config: SEED_CONFIG as unknown as Step["config"],
  enabled: true,
};
const laneStep: Step = {
  id: "22222222-2222-2222-2222-222222222222",
  opType: FILTER_OP,
  label: "Other lane",
  config: { combinator: "AND", conditions: [] },
  enabled: true,
};

function Harness() {
  const state = useStepCardState(joinStep, jest.fn());
  return (
    <StepOpEditor
      step={joinStep}
      allSteps={[joinStep, laneStep]}
      analyzeColumns={["id", "qty"]}
      analyzeSchema={[
        { name: "id", type: "string" },
        { name: "qty", type: "number" },
      ]}
      isOwner
      stepCardState={state}
    />
  );
}

function choose(comboboxName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

async function lastPersistedBody(): Promise<unknown> {
  await act(async () => {
    jest.runAllTimers();
  });
  const calls = updatePipelineStepMock.mock.calls;
  return calls[calls.length - 1][1];
}

describe("join step config seam (shared fixture)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    updatePipelineStepMock.mockReset();
    updatePipelineStepMock.mockResolvedValue({} as PipelineStep);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("persists exactly the source-kind fixture config", async () => {
    renderWithStore(<Harness />, {
      sources: {
        items: [
          {
            id:
              fixture.cases.source.secondaryInput.kind === "source"
                ? fixture.cases.source.secondaryInput.dataSourceId
                : "",
            name: "Customers",
            type: "rest_api",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            inferredSchema: [],
            config: { url: "https://example.com/api" },
          },
        ],
        status: "succeeded",
      },
    });
    expect(updatePipelineStepMock).not.toHaveBeenCalled();
    choose("Right source", "Data source: Customers");
    choose("Join key", fixture.cases.source.joinKey);
    fireEvent.click(
      screen.getByRole("button", { name: fixture.cases.source.joinType.toUpperCase() }),
    );
    const body = (await lastPersistedBody()) as Record<string, unknown>;
    expect(body).toEqual(fixture.cases.source);
    expect(Object.keys(body).sort()).toEqual(Object.keys(fixture.cases.source).sort());
  });

  it("persists exactly the lane-kind fixture config", async () => {
    renderWithStore(<Harness />);
    choose("Right source", "Lane node: Other lane");
    choose("Join key", fixture.cases.lane.joinKey);
    fireEvent.click(
      screen.getByRole("button", { name: fixture.cases.lane.joinType.toUpperCase() }),
    );
    const body = (await lastPersistedBody()) as Record<string, unknown>;
    expect(body).toEqual(fixture.cases.lane);
    expect(Object.keys(body).sort()).toEqual(Object.keys(fixture.cases.lane).sort());
  });
});
