import { runSessionResets } from "../../../shared/session/sessionReset";
import { patchShellPreferencesRequest } from "./authService";
import { queuePreferencesPatch, type PreferencesSaveOutcome } from "./preferencesSaveQueue";

jest.mock("./authService", () => ({ patchShellPreferencesRequest: jest.fn() }));

const sender = jest.mocked(patchShellPreferencesRequest);

interface Call {
  body: Record<string, unknown>;
  ok: () => void;
  fail: () => void;
}
let calls: Call[] = [];

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

afterEach(() => {
  // Leave no module state behind for the next test.
  runSessionResets();
});

/** Lets promise continuations run. */
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe("preferencesSaveQueue (HEL-1829)", () => {
  it("coalesces a burst behind one in-flight request into ONE trailing request: latest per key, null kept", async () => {
    const first = queuePreferencesPatch({ typeStyle: "mono" });
    const second = queuePreferencesPatch({ typeStyle: "sans" });
    const third = queuePreferencesPatch({ motion: null });
    const fourth = queuePreferencesPatch({ typeStyle: "serif" });
    expect(calls).toHaveLength(1);
    calls[0].ok();
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toEqual({ typeStyle: "serif", motion: null });
    calls[1].ok();
    const outcomes = await Promise.all([first, second, third, fourth]);
    expect(outcomes[0]).toEqual({ status: "saved", sent: { typeStyle: "mono" } });
    for (const outcome of outcomes.slice(1)) {
      expect(outcome).toEqual({ status: "saved", sent: { typeStyle: "serif", motion: null } });
    }
    expect(calls).toHaveLength(2);
  });

  it("never has two requests in flight", async () => {
    void queuePreferencesPatch({ density: "compact" });
    void queuePreferencesPatch({ density: "comfortable" });
    void queuePreferencesPatch({ typeStyle: "mono" });
    await flush();
    expect(calls).toHaveLength(1);
  });

  it("a failed in-flight request still drains the trailing one", async () => {
    const first = queuePreferencesPatch({ typeStyle: "mono" });
    const second = queuePreferencesPatch({ typeStyle: "serif" });
    calls[0].fail();
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toEqual({ typeStyle: "serif" });
    calls[1].ok();
    expect((await first).status).toBe("failed");
    expect((await second).status).toBe("saved");
  });

  it("a rejected coalesced request fails every rider with no re-send (D3a)", async () => {
    const inFlight = queuePreferencesPatch({ density: "compact" });
    const riderA = queuePreferencesPatch({ typeStyle: "mono" });
    const riderB = queuePreferencesPatch({ assistantModel: "claude-opus-5-5" });
    calls[0].ok();
    await inFlight;
    await flush();
    expect(calls[1].body).toEqual({ typeStyle: "mono", assistantModel: "claude-opus-5-5" });
    calls[1].fail();
    const [a, b] = await Promise.all([riderA, riderB]);
    expect(a.status).toBe("failed");
    expect(b.status).toBe("failed");
    await flush();
    expect(calls).toHaveLength(2);
  });

  it("resolves callers in the order they queued", async () => {
    const order: string[] = [];
    const track = (name: string, p: Promise<PreferencesSaveOutcome>) =>
      p.then(() => order.push(name));
    const all = [
      track("a", queuePreferencesPatch({ typeStyle: "mono" })),
      track("b", queuePreferencesPatch({ density: "compact" })),
      track("c", queuePreferencesPatch({ typeStyle: "serif" })),
    ];
    calls[0].ok();
    await flush();
    calls[1].ok();
    await Promise.all(all);
    expect(order).toEqual(["a", "b", "c"]);
  });

  describe("keepalive (D4, D4a)", () => {
    const fetchMock = jest.fn();
    beforeEach(() => {
      fetchMock.mockReset();
      global.fetch = fetchMock as never;
    });

    it("sends with fetch keepalive when nothing is in flight, and classifies a non-ok response as failed", async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
      const outcome = await queuePreferencesPatch(
        { dashboardTabs: { tabs: [] } },
        { keepalive: true },
      );
      expect(outcome.status).toBe("failed");
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH", keepalive: true });
      expect(sender).not.toHaveBeenCalled();
    });

    it("an ok keepalive response is saved; a rejected fetch is failed", async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });
      expect(
        (await queuePreferencesPatch({ density: "compact" }, { keepalive: true })).status,
      ).toBe("saved");
      fetchMock.mockRejectedValueOnce(new Error("network"));
      expect(
        (await queuePreferencesPatch({ density: "compact" }, { keepalive: true })).status,
      ).toBe("failed");
    });

    it("while a request is in flight it waits (never unordered) and the trailing request is the keepalive one", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      void queuePreferencesPatch({ typeStyle: "mono" });
      const flushed = queuePreferencesPatch({ dashboardTabs: { tabs: [] } }, { keepalive: true });
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
      calls[0].ok();
      expect((await flushed).status).toBe("saved");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ dashboardTabs: { tabs: [] } });
    });
  });

  describe("sign-out (D5)", () => {
    it("drops a pending patch: it is never sent and its callers resolve dropped", async () => {
      void queuePreferencesPatch({ typeStyle: "mono" });
      const pending = queuePreferencesPatch({ typeStyle: "serif" });
      runSessionResets();
      expect(await pending).toEqual({ status: "dropped", sent: null });
      calls[0].ok();
      await flush();
      expect(calls).toHaveLength(1);
    });

    it("A in flight, reset, B#1 sent at once, B#2 queued, A settles: B#2 waits for B#1", async () => {
      const a = queuePreferencesPatch({ typeStyle: "mono" });
      runSessionResets();
      void queuePreferencesPatch({ density: "compact" }); // B #1
      expect(calls).toHaveLength(2);
      const b2 = queuePreferencesPatch({ density: "comfortable" }); // B #2
      calls[0].ok(); // A settles
      expect((await a).status).toBe("saved");
      await flush();
      expect(calls).toHaveLength(2); // B#2 NOT sent yet
      calls[1].ok(); // B #1 settles
      await flush();
      expect(calls).toHaveLength(3);
      expect(calls[2].body).toEqual({ density: "comfortable" });
      calls[2].ok();
      expect((await b2).status).toBe("saved");
    });
  });
});
