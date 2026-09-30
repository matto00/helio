import { resetTelemetryForTests, setTelemetryIdentity, track } from "./track";
import { isFirstDashboardDelivered } from "./firstDashboardFlag";

const fetchMock = jest.fn();
let warn: jest.SpyInstance;

const ok = () => Promise.resolve({ ok: true, status: 202 });
const status = (code: number) => Promise.resolve({ ok: false, status: code });

async function flushTimers() {
  await jest.advanceTimersByTimeAsync(2500);
}

beforeEach(() => {
  jest.useFakeTimers();
  resetTelemetryForTests();
  window.localStorage.clear();
  setTelemetryIdentity(() => "user-1");
  fetchMock.mockReset().mockImplementation(ok);
  global.fetch = fetchMock as unknown as typeof fetch;
  warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  warn.mockRestore();
});

describe("track (HEL-1208)", () => {
  it("returns synchronously without calling the network, then sends one batched keepalive POST", async () => {
    const result = track("provenance_opened", {});
    track("firstrun_file_dropped", { source: "drop" });
    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    await flushTimers();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/events");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe("include");
    const body = JSON.parse(init.body);
    expect(body.events.map((e: { event: string }) => e.event)).toEqual([
      "provenance_opened",
      "firstrun_file_dropped",
    ]);
    expect(body.events[1].properties).toEqual({ source: "drop" });
    expect(typeof body.events[0].occurredAt).toBe("string");
  });

  it("swallows a failing request and warns at most once across repeated failures", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("network down")));
    expect(() => track("provenance_opened", {})).not.toThrow();
    await flushTimers();
    track("provenance_opened", {});
    await flushTimers();

    expect(fetchMock).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("keeps events queued while offline and delivers them when the browser comes back online", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    track("provenance_opened", {});
    await flushTimers();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(ok);
    window.dispatchEvent(new Event("online"));
    await jest.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).events).toHaveLength(1);
  });

  it("drops a batch the server rejects as invalid or unauthenticated instead of retrying it forever", async () => {
    fetchMock.mockImplementation(() => status(401));
    track("provenance_opened", {});
    await flushTimers();
    await flushTimers();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a batch on a 5xx response", async () => {
    fetchMock.mockImplementationOnce(() => status(503));
    track("provenance_opened", {});
    await flushTimers();
    await jest.advanceTimersByTimeAsync(11000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never throws even when localStorage is unavailable", async () => {
    const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => track("provenance_opened", {})).not.toThrow();
    await flushTimers();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("never sends user A's queued events once user B is signed in", async () => {
    let current = "user-a";
    setTelemetryIdentity(() => current);
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    track("provenance_opened", {});
    await flushTimers();

    current = "user-b";
    fetchMock.mockImplementation(ok);
    track("firstrun_file_dropped", { source: "paste" });
    await flushTimers();

    const sent = fetchMock.mock.calls.slice(1).flatMap((c) => JSON.parse(c[1].body).events);
    expect(sent.map((e: { event: string }) => e.event)).toEqual(["firstrun_file_dropped"]);
  });

  it("queues nothing when no user is signed in", async () => {
    setTelemetryIdentity(() => null);
    track("provenance_opened", {});
    await flushTimers();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks first_dashboard_rendered delivered only after the server accepts it", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    track("first_dashboard_rendered", { panelCount: 2 });
    await flushTimers();
    expect(isFirstDashboardDelivered("user-1")).toBe(false);

    fetchMock.mockImplementation(ok);
    window.dispatchEvent(new Event("online"));
    await jest.advanceTimersByTimeAsync(0);
    expect(isFirstDashboardDelivered("user-1")).toBe(true);
  });

  it("does not mark first_dashboard_rendered delivered when the batch is dropped as rejected", async () => {
    fetchMock.mockImplementation(() => status(400));
    track("first_dashboard_rendered", { panelCount: 2 });
    await flushTimers();
    expect(isFirstDashboardDelivered("user-1")).toBe(false);
  });
});
