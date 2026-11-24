import { store } from "../../../store/store";
import { httpClient } from "../../../services/httpClient";
import { saveAssistantModelPreference } from "../../settings/state/saveAssistantModelPreference";
import { saveAppearancePreferences } from "./authSlice";

// HEL-1829: drives the EXISTING public writers with the first PATCH held, against a fake server that applies
// `PATCH /api/users/me/preferences` with merge semantics (jsonb `||`, `null` removes the key) in ARRIVAL order.

jest.mock("../../../services/httpClient", () => ({
  httpClient: { patch: jest.fn(), get: jest.fn() },
}));

const mockedHttp = jest.mocked(httpClient);

interface FakeServer {
  stored: Record<string, unknown>;
  bodies: Record<string, unknown>[];
  maxInFlight: () => number;
  releaseHeld: () => void;
}

/** The first PATCH is held (its body reaches the server only when released); every later one arrives at once. */
function installFakeServer(): FakeServer {
  const stored: Record<string, unknown> = {};
  const bodies: Record<string, unknown>[] = [];
  let inFlight = 0;
  let peak = 0;
  let release: () => void = () => undefined;
  const apply = (body: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(body)) {
      if (value === null) delete stored[key];
      else stored[key] = value;
    }
  };
  mockedHttp.patch.mockImplementation(async (_url: string, body?: unknown) => {
    const sent = body as Record<string, unknown>;
    bodies.push(sent);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      if (bodies.length === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      apply(sent);
      return { data: { ...stored } };
    } finally {
      inFlight -= 1;
    }
  });
  mockedHttp.get.mockResolvedValue({
    data: { models: [], serverDefault: "claude-haiku-5-5", defaultModel: "claude-haiku-5-5" },
  });
  return { stored, bodies, maxInFlight: () => peak, releaseHeld: () => release() };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("preference saves are ordered (HEL-1829)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("rapid Mono -> Sans -> Serif with the first PATCH held ends stored as serif, at most 2 requests, 1 in flight", async () => {
    const server = installFakeServer();
    const saves = [
      store.dispatch(saveAppearancePreferences({ typeStyle: "mono" })),
      store.dispatch(saveAppearancePreferences({ typeStyle: "sans" })),
      store.dispatch(saveAppearancePreferences({ typeStyle: "serif" })),
    ];
    await tick();
    server.releaseHeld();
    await Promise.all(saves);
    await tick();

    expect(server.stored.typeStyle).toBe("serif");
    expect(server.bodies.length).toBeLessThanOrEqual(2);
    expect(server.maxInFlight()).toBe(1);
  });

  it("a held appearance save plus a density save and an assistant-model save: one trailing request carrying every key", async () => {
    const server = installFakeServer();
    const saves = [
      store.dispatch(saveAppearancePreferences({ typeStyle: "mono" })),
      store.dispatch(saveAppearancePreferences({ density: "compact" })),
      store.dispatch(saveAssistantModelPreference("claude-opus-5-5")),
    ];
    await tick();
    server.releaseHeld();
    await Promise.all(saves);
    await tick();

    expect(server.stored).toMatchObject({
      typeStyle: "mono",
      density: "compact",
      assistantModel: "claude-opus-5-5",
    });
    // Red is on request count and concurrency only: per-key server merge means different keys cannot overwrite.
    expect(server.bodies).toHaveLength(2);
    expect(server.maxInFlight()).toBe(1);
  });
});
