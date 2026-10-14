import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { authReducer } from "../../features/auth/state/authSlice";
import { patchShellPreferencesRequest } from "../../features/auth/services/authService";
import type { UserPreferences } from "../../features/auth/types/user";
import { useContextListLayout } from "./useContextListLayout";

jest.mock("../../features/auth/services/authService", () => ({
  patchShellPreferencesRequest: jest.fn().mockResolvedValue({}),
}));

const patchMock = jest.mocked(patchShellPreferencesRequest);

function makeStore(preferences?: Partial<UserPreferences>) {
  return configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        status: "authenticated" as const,
        submitStatus: "idle" as const,
        mfaChallenge: null,
        currentUser: {
          id: "u1",
          email: "u@example.com",
          displayName: null,
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
          tier: "free" as const,
          preferences:
            preferences === undefined
              ? undefined
              : { accentColor: null, zoomLevels: {}, ...preferences },
        },
      },
    },
  });
}

function setup(preferences?: Partial<UserPreferences>) {
  const store = makeStore(preferences);
  const wrapper = ({ children }: PropsWithChildren) => (
    <Provider store={store}>{children}</Provider>
  );
  return { store, ...renderHook(() => useContextListLayout(), { wrapper }) };
}

describe("useContextListLayout", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    patchMock.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => jest.useRealTimers());

  it("first render already has the saved width and collapsed state (no default flash)", () => {
    const { result } = setup({ contextListWidth: 320, contextListCollapsed: true });
    expect(result.current.width).toBe(320);
    expect(result.current.collapsed).toBe(true);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("falls back to 248px expanded when never set, and clamps an out-of-range saved width", () => {
    expect(setup().result.current).toMatchObject({ width: 248, collapsed: false });
    expect(setup({ contextListWidth: 9999 }).result.current.width).toBe(400);
    expect(setup({ contextListWidth: 5 }).result.current.width).toBe(200);
  });

  it("commitWidth (a pointer drag's end) applies locally and writes exactly once", () => {
    const { result } = setup();
    act(() => result.current.commitWidth(300));
    expect(result.current.width).toBe(300);
    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock).toHaveBeenCalledWith({ contextListWidth: 300 });
  });

  it("previewWidth never touches state or the network", () => {
    const { result } = setup();
    for (let w = 250; w < 330; w += 10) act(() => result.current.previewWidth(w));
    expect(result.current.width).toBe(248);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("debounces a burst of keyboard resizes into one write of the final value", () => {
    const { result } = setup();
    act(() => result.current.nudgeWidth(264));
    act(() => result.current.nudgeWidth(280));
    act(() => result.current.nudgeWidth(296));
    expect(result.current.width).toBe(296);
    expect(patchMock).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(399);
    });
    expect(patchMock).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock).toHaveBeenCalledWith({ contextListWidth: 296 });
  });

  it("writes a collapse toggle immediately", () => {
    const { result } = setup();
    act(() => result.current.toggleCollapsed());
    expect(result.current.collapsed).toBe(true);
    expect(patchMock).toHaveBeenCalledWith({ contextListCollapsed: true });
  });

  it("keeps the local value, silently, when the write fails", async () => {
    patchMock.mockRejectedValueOnce(new Error("offline"));
    const { result } = setup();
    await act(async () => {
      result.current.commitWidth(333);
    });
    expect(result.current.width).toBe(333);
  });

  describe("legacy helio.sidebarCollapsed key", () => {
    it("migrates a collapsed flag once when the server has none, then removes the key", () => {
      window.localStorage.setItem("helio.sidebarCollapsed", "true");
      const { result } = setup();
      expect(result.current.collapsed).toBe(true);
      expect(patchMock).toHaveBeenCalledWith({ contextListCollapsed: true });
      expect(window.localStorage.getItem("helio.sidebarCollapsed")).toBeNull();
    });

    it("does not override a value the server already has, but still removes the key", () => {
      window.localStorage.setItem("helio.sidebarCollapsed", "true");
      const { result } = setup({ contextListCollapsed: false });
      expect(result.current.collapsed).toBe(false);
      expect(patchMock).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("helio.sidebarCollapsed")).toBeNull();
    });

    it("ignores a legacy 'false' (nothing to migrate) and removes it", () => {
      window.localStorage.setItem("helio.sidebarCollapsed", "false");
      setup();
      expect(patchMock).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("helio.sidebarCollapsed")).toBeNull();
    });
  });
});
