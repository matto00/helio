// HEL-1631: the dialog stays mounted while closed, so it re-renders with the whole pipeline page (every draft edit). Its timezone
// datalist (several hundred <option>s) must be built once, not on every render: it cost ~40 ms of a ~100 ms edit at 4x CPU.

import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";

import { PipelineScheduleDialog } from "./PipelineScheduleDialog";
import { pipelinesReducer } from "../../state/pipelinesSlice";

const zones = ["UTC", "Europe/Oslo", "America/New_York"];
const mapSpy = jest.spyOn(zones, "map");

jest.mock("./schedulePreview", () => ({
  ...jest.requireActual("./schedulePreview"),
  supportedTimezones: () => zones,
}));

jest.mock("../../services/pipelineService", () => ({
  getPipelineSchedule: jest.fn(),
  putPipelineSchedule: jest.fn(),
  deletePipelineSchedule: jest.fn(),
}));

describe("PipelineScheduleDialog re-renders", () => {
  it("does not rebuild the timezone options when re-rendered with unchanged timezones", () => {
    const store = configureStore({ reducer: { pipelines: pipelinesReducer } as never });
    const tree = (name: string) => (
      <Provider store={store}>
        <PipelineScheduleDialog
          pipelineId={`p-${name}`.slice(0, 3)}
          schedule={null}
          open={false}
          onClose={() => undefined}
        />
      </Provider>
    );
    const { rerender } = render(tree("1"));
    const afterFirst = mapSpy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    for (let i = 0; i < 5; i += 1) rerender(tree("1"));
    expect(mapSpy.mock.calls.length).toBe(afterFirst);
  });
});
