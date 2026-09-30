import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";

import * as telemetry from "./track";
import { useFirstDashboardRendered } from "./useFirstDashboardRendered";
import {
  markFirstDashboardDelivered,
  resetFirstDashboardStateForTests,
} from "./firstDashboardFlag";

jest.mock("./track", () => ({ track: jest.fn() }));
const track = jest.mocked(telemetry.track);

function makeStore(userId: string | null, panelCount = 3) {
  return configureStore({
    reducer: {
      auth: () => ({ currentUser: userId ? { id: userId } : null }),
      panels: () => ({ items: Array.from({ length: panelCount }, (_, i) => ({ id: `p${i}` })) }),
    },
  });
}

function renderWith(store: ReturnType<typeof makeStore>, rendered: boolean) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store as never}>{children}</Provider>
  );
  return renderHook(({ r }) => useFirstDashboardRendered(r), {
    wrapper,
    initialProps: { r: rendered },
  });
}

beforeEach(() => {
  track.mockClear();
  window.localStorage.clear();
  resetFirstDashboardStateForTests();
});

describe("useFirstDashboardRendered (HEL-1208)", () => {
  it("emits once with the dashboard's panel count when an output panel has rendered rows", () => {
    const { rerender } = renderWith(makeStore("u1"), true);
    rerender({ r: true });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("first_dashboard_rendered", { panelCount: 3 });
  });

  it("does not emit for an empty, errored or non-output panel", () => {
    renderWith(makeStore("u1"), false);
    expect(track).not.toHaveBeenCalled();
  });

  it("does not emit again for a user whose delivery was already confirmed (reload)", () => {
    markFirstDashboardDelivered("u1");
    renderWith(makeStore("u1"), true);
    expect(track).not.toHaveBeenCalled();
  });

  it("re-emits on a later mount when delivery was never confirmed, since the server dedupes", () => {
    renderWith(makeStore("u1"), true);
    resetFirstDashboardStateForTests();
    renderWith(makeStore("u1"), true);
    expect(track).toHaveBeenCalledTimes(2);
  });

  it("emits for a different user on the same browser", () => {
    renderWith(makeStore("u1"), true);
    renderWith(makeStore("u2"), true);
    expect(track).toHaveBeenCalledTimes(2);
  });

  it("does not emit without a signed-in user", () => {
    renderWith(makeStore(null), true);
    expect(track).not.toHaveBeenCalled();
  });
});
