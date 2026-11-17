import { configureStore } from "@reduxjs/toolkit";
import { render } from "@testing-library/react";
import { Profiler } from "react";
import { Provider } from "react-redux";

import { useNow } from "../../../../hooks/useNow";
import { sourceSamplesReducer } from "../../../sources/state/sourceSamplesSlice";
import { sourcesReducer } from "../../../sources/state/sourcesSlice";
import { ownedSource } from "../../../sources/test/sampleFixtures";
import { pipelinesReducer } from "../../state/pipelinesSlice";
import { SpineSourceCard } from "./SpineSourceCard";

jest.mock("../../../../hooks/useNow", () => ({ useNow: jest.fn(() => Date.now()) }));
jest.mock("../../../sources/services/dataSourceService", () => ({
  fetchSourceSample: jest.fn().mockResolvedValue(null),
  fetchSources: jest.fn(),
  fetchSourceReferences: jest.fn().mockResolvedValue([]),
}));

// HEL-1675: the card shows one sample label, so it needs one age timer subscription. Before the split the card ran
// `useSourceSampleLabel` itself AND mounted `SourceSampleLabel`, which ran it again: two `useNow` calls per render.
it("subscribes to one age timer per render of a source card", () => {
  const store = configureStore({
    reducer: {
      sources: sourcesReducer,
      sourceSamples: sourceSamplesReducer,
      pipelines: pipelinesReducer,
    },
  });
  const useNowMock = jest.mocked(useNow);
  useNowMock.mockClear();
  let commits = 0;
  render(
    <Provider store={store}>
      <Profiler id="card" onRender={() => (commits += 1)}>
        <SpineSourceCard
          root={{ id: "r1", dataSourceId: "s1", dataSourceName: "Orders" }}
          pipelineId="P1"
          source={ownedSource("s1")}
          ordinal={null}
          canRemove
          onEditSource={jest.fn()}
          onRemoveRoot={jest.fn()}
        />
      </Profiler>
    </Provider>,
  );
  expect(commits).toBeGreaterThan(0);
  expect(useNowMock).toHaveBeenCalledTimes(commits);
});
