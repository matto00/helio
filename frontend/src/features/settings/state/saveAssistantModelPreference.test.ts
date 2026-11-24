import { configureStore } from "@reduxjs/toolkit";

import { authReducer } from "../../auth/state/authSlice";
import { patchShellPreferencesRequest } from "../../auth/services/authService";
import { runSessionResets } from "../../../shared/session/sessionReset";
import { saveAssistantModelPreference } from "./saveAssistantModelPreference";
import type { AppDispatch, RootState } from "../../../store/store";

jest.mock("../../auth/services/authService", () => ({ patchShellPreferencesRequest: jest.fn() }));
jest.mock("../../assistant/state/assistantModelsSlice", () => ({
  fetchAssistantModels: () => ({ type: "test/fetchAssistantModels" }),
}));
jest.mock("../../assistant/state/assistantConversationsSlice", () => ({
  selectConversation: () => ({ type: "test/selectConversation" }),
}));

const sender = jest.mocked(patchShellPreferencesRequest);

interface Call {
  body: Record<string, unknown>;
  ok: () => void;
  fail: () => void;
}
let calls: Call[] = [];

function makeStore(assistantModel?: string) {
  const initial = authReducer(undefined, { type: "init" });
  const store = configureStore({
    reducer: {
      auth: authReducer,
      assistantConversations: (s: unknown = { activeConversation: { data: null } }) => s,
    } as never,
    preloadedState: {
      auth: {
        ...initial,
        currentUser: {
          id: "u1",
          email: "u@x.dev",
          preferences: {
            accentColor: null,
            zoomLevels: {},
            ...(assistantModel ? { assistantModel } : {}),
          },
        },
      },
    } as never,
  });
  return store as unknown as { dispatch: AppDispatch; getState: () => RootState };
}

const stored = (store: { getState: () => RootState }) =>
  store.getState().auth.currentUser?.preferences?.assistantModel;
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

beforeEach(() => {
  calls = [];
  sender.mockReset();
  sender.mockImplementation(
    (body) =>
      new Promise((resolve, reject) => {
        calls.push({
          body: body as Record<string, unknown>,
          ok: () => resolve({ accentColor: null, zoomLevels: {} }),
          fail: () => reject(new Error("400")),
        });
      }),
  );
});
afterEach(() => runSessionResets());

describe("saveAssistantModelPreference rollback (HEL-1829 D6)", () => {
  it("(a) X in flight, then Y, then X: the first X failing does not roll back; the trailing X succeeds -> X local and sent", async () => {
    const store = makeStore("P");
    const first = store.dispatch(
      saveAssistantModelPreference("X") as never,
    ) as unknown as Promise<boolean>;
    const y = store.dispatch(
      saveAssistantModelPreference("Y") as never,
    ) as unknown as Promise<boolean>;
    const x2 = store.dispatch(
      saveAssistantModelPreference("X") as never,
    ) as unknown as Promise<boolean>;
    calls[0].fail();
    expect(await first).toBe(false);
    expect(stored(store)).toBe("X");
    await flush();
    expect(calls[1].body).toEqual({ assistantModel: "X" });
    calls[1].ok();
    expect(await y).toBe(true);
    expect(await x2).toBe(true);
    expect(stored(store)).toBe("X");
  });

  it("(b) X in flight, Y queued; X fails (no rollback), Y fails -> restored to P, never X", async () => {
    const store = makeStore("P");
    const x = store.dispatch(
      saveAssistantModelPreference("X") as never,
    ) as unknown as Promise<boolean>;
    const y = store.dispatch(
      saveAssistantModelPreference("Y") as never,
    ) as unknown as Promise<boolean>;
    calls[0].fail();
    await x;
    expect(stored(store)).toBe("Y");
    await flush();
    calls[1].fail();
    await y;
    expect(stored(store)).toBe("P");
  });

  it("(c) X succeeds, then Y (newest) fails -> restored to X, the confirmed value", async () => {
    const store = makeStore("P");
    const x = store.dispatch(
      saveAssistantModelPreference("X") as never,
    ) as unknown as Promise<boolean>;
    const y = store.dispatch(
      saveAssistantModelPreference("Y") as never,
    ) as unknown as Promise<boolean>;
    calls[0].ok();
    await x;
    await flush();
    calls[1].fail();
    await y;
    expect(stored(store)).toBe("X");
  });

  it("a superseded caller never records its own value as confirmed", async () => {
    const store = makeStore("P");
    const x = store.dispatch(
      saveAssistantModelPreference("X") as never,
    ) as unknown as Promise<boolean>;
    const y = store.dispatch(
      saveAssistantModelPreference("Y") as never,
    ) as unknown as Promise<boolean>;
    const z = store.dispatch(
      saveAssistantModelPreference("Z") as never,
    ) as unknown as Promise<boolean>;
    calls[0].ok(); // X confirmed
    await x;
    await flush();
    expect(calls[1].body).toEqual({ assistantModel: "Z" }); // Y was superseded in the same trailing request
    calls[1].fail();
    await Promise.all([y, z]);
    // Y's failed outcome must not roll back (not newest); Z (newest) restores X, never Y.
    expect(stored(store)).toBe("X");
  });
});
