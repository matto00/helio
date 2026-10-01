import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

import { resetTelemetryForTests, setTelemetryIdentity, track, type TelemetryEvent } from "./track";

/** HEL-1220 seam test. The batch the client really serializes is compared with a committed
 *  fixture that the backend's `ProductEventRegistrySpec` runs through the real
 *  `validateClientEvent`. Drift on either side therefore fails a test. Regenerate deliberately
 *  with `UPDATE_TELEMETRY_FIXTURE=1 npm test -- --testPathPatterns=track.wireContract`. */
const FIXTURE_PATH = resolve(
  __dirname,
  "../../../../backend/src/test/resources/telemetry/client-wire-batch.json",
);
const FIXED_NOW = new Date("2026-09-30T12:00:00.000Z");

/** Exhaustive by construction: a new TelemetryEvent variant without an entry here is a compile
 *  error, so it cannot be left out of the contract fixture. */
const SAMPLE_PROPS: {
  [K in TelemetryEvent["event"]]: Extract<TelemetryEvent, { event: K }>["props"];
} = {
  first_dashboard_rendered: { panelCount: 3 },
  provenance_opened: {},
  firstrun_file_dropped: { source: "drop" },
  firstrun_dashboard_created: { panelCount: 2 },
  firstrun_template_chosen: { template: "sales-overview" },
};

/** `track`'s props are correlated to the event name; the exhaustive map above already carries
 *  that correlation, so the erased call is safe here. */
const trackLoose = track as (name: TelemetryEvent["event"], props: unknown) => void;

function trackSample(name: TelemetryEvent["event"]): void {
  trackLoose(name, SAMPLE_PROPS[name]);
}

describe("client wire payload contract (HEL-1220)", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);
    resetTelemetryForTests();
    window.localStorage.clear();
    setTelemetryIdentity(() => "user-1");
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 202 });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("serializes every event variant as exactly {event, properties, occurredAt}", async () => {
    (Object.keys(SAMPLE_PROPS) as TelemetryEvent["event"][]).forEach(trackSample);
    await jest.advanceTimersByTimeAsync(2500);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { events: unknown[] };

    if (process.env.UPDATE_TELEMETRY_FIXTURE === "1") {
      mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
      writeFileSync(FIXTURE_PATH, JSON.stringify(body, null, 2) + "\n");
    }

    // readFileSync throws when the fixture is missing, so a missing file FAILS rather than skips.
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as unknown;
    expect(body).toEqual(fixture);
    expect(body.events).toHaveLength(Object.keys(SAMPLE_PROPS).length);
  });
});
