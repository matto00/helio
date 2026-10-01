import * as telemetry from "../../telemetry/track";
import { onProvenanceOpened } from "./provenanceTelemetry";

jest.mock("../../telemetry/track", () => ({ track: jest.fn() }));
const track = jest.mocked(telemetry.track);

beforeEach(() => track.mockClear());

describe("onProvenanceOpened (HEL-1208)", () => {
  it("tracks provenance_opened with no properties for an authenticated open", () => {
    onProvenanceOpened({ panelId: "panel-1", variant: "authenticated" });
    expect(track).toHaveBeenCalledWith("provenance_opened", {});
  });

  it("sends nothing from the unauthenticated public share view", () => {
    onProvenanceOpened({ panelId: "panel-1", variant: "public" });
    expect(track).not.toHaveBeenCalled();
  });
});
