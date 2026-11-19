// HEL-1781 D2/D5/D6: a grantee's answer card reads each citation's provenance through the per-panel route (never an Output
// route), renders an unmatched citation as plain text, and shows no pin when the server returns none. The owner is unchanged.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import { httpClient } from "../../../services/httpClient";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { renderWithStore } from "../../../test/renderWithStore";
import type { User } from "../../auth/types/user";
import { resetProvenanceCache } from "../../panels/provenance/provenanceCache";
import { fetchPanels } from "../../panels/state/panelThunks";
import { AskPanel } from "./AskPanel";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../panels/provenance/provenanceTelemetry", () => ({ onProvenanceOpened: jest.fn() }));
jest.mock("../../panels/services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));
jest.mock("../../panels/insight/InsightMarkdown", () => ({
  InsightMarkdown: ({
    markdown,
    citations,
    renderCitation,
  }: {
    markdown: string;
    citations: string[];
    renderCitation: (id: string) => import("react").ReactNode;
  }) => (
    <p>
      {markdown.split(/(\[c\d+\])/).map((part, i) => {
        const id = /^\[(c\d+)\]$/.exec(part)?.[1];
        return id && citations.includes(id) ? <span key={i}>{renderCitation(id)}</span> : part;
      })}
    </p>
  ),
}));
const http = jest.mocked(httpClient);

const user = (tier: User["tier"]): User => ({
  id: "u-1",
  email: "a@example.com",
  displayName: null,
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  tier,
});

const ANSWER = {
  answer: "Revenue is 10 [c1] and cost is 5 [c2].",
  citations: [
    { id: "c1", outputId: "o-1", field: "revenue", number: 10, isPct: false },
    { id: "c2", outputId: "o-2", field: "cost", number: 5, isPct: false },
  ],
  citedOutputs: [
    { id: "o-1", name: "Revenue" },
    { id: "o-2", name: "Cost" },
  ],
  pin: null,
};

const CHAIN = {
  outputId: "o-1",
  pipeline: { id: "pipe-1", name: "Weekly sales" },
  sources: [],
  nodePath: [],
  lastRun: { status: "succeeded", completedAt: "2026-09-29T10:00:00Z", rowCount: 42 },
  assertions: { defined: false, passed: 0, failed: 0, warned: 0, rootBound: false },
};

function setup(
  props: { role: "owner" | "editor" | "viewer"; tier?: User["tier"]; boundOutputs?: string[] } = {
    role: "viewer",
  },
) {
  const panels = (props.boundOutputs ?? ["o-1"]).map((outputId, i) =>
    makeOutputPanel({ id: `pn-${i + 1}`, dashboardId: "d-1", config: { outputId } }),
  );
  const ctx = renderWithStore(<AskPanel scope={{ kind: "dashboard", id: "d-1" }} />, {
    auth: { status: "authenticated", currentUser: user(props.tier ?? "beta") },
    dashboards: {
      items: [
        {
          id: "d-1",
          name: "Board",
          accessRole: props.role,
          ownerId: props.role === "owner" ? "u-1" : "other",
        },
      ],
      selectedDashboardId: "d-1",
    },
  });
  act(() => {
    ctx.store.dispatch(fetchPanels.pending("r", "d-1"));
    ctx.store.dispatch(fetchPanels.fulfilled(panels, "r", "d-1"));
  });
  return ctx;
}

function ask() {
  fireEvent.change(screen.getByRole("textbox", { name: "Your question" }), {
    target: { value: "Why?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}

const urls = (m: jest.Mock) => m.mock.calls.map(([u]) => String(u));

beforeEach(() => {
  jest.resetAllMocks();
  resetProvenanceCache();
  http.get.mockResolvedValue({ data: CHAIN });
  http.post.mockResolvedValue({ data: ANSWER });
});

describe("AskAnswerCard for a non-owner (HEL-1781 D2)", () => {
  it.each(["viewer", "editor"] as const)(
    "a %s's chip reads the per-panel provenance route with the mapped panel id and never an Output route",
    async (role) => {
      setup({ role });
      ask();
      const chip = await screen.findByRole("button", { name: /^Source: revenue/ });
      fireEvent.click(chip);
      await waitFor(() =>
        expect(urls(http.get)).toContain("/api/dashboards/d-1/panels/pn-1/provenance"),
      );
      expect(urls(http.get).filter((u) => u.includes("/api/outputs"))).toEqual([]);
      expect(urls(http.get).filter((u) => u.includes("/api/pipelines"))).toEqual([]);
    },
  );

  it("renders a citation whose Output no panel here binds as plain ordinal text, with no button", async () => {
    setup({ role: "viewer" });
    ask();
    await screen.findByRole("button", { name: /^Source: revenue/ });
    expect(screen.queryByRole("button", { name: /^Source: cost/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Answer" })).toHaveTextContent("cost is 5 2");
  });

  it("keeps the panel lookup referentially stable (no react-redux unstable-selector warning)", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      setup({ role: "viewer" });
      ask();
      await screen.findByRole("button", { name: /^Source: revenue/ });
      const unstable = warn.mock.calls.filter((c) =>
        String(c[0]).includes("returned a different result"),
      );
      expect(unstable).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("shows no pin action when the server returns pin: null", async () => {
    setup({ role: "editor" });
    ask();
    await screen.findByRole("region", { name: "Answer" });
    expect(screen.queryByRole("button", { name: /pin/i })).not.toBeInTheDocument();
  });

  it("a free-tier grantee sees the upsell and sends no ask request", () => {
    setup({ role: "viewer", tier: "free" });
    expect(screen.queryByRole("textbox", { name: "Your question" })).not.toBeInTheDocument();
    expect(urls(http.post).filter((u) => u.endsWith("/ask"))).toEqual([]);
  });
});

describe("AskAnswerCard for the owner (HEL-1781 D2, unchanged)", () => {
  it("still reads the Output provenance route", async () => {
    setup({ role: "owner", boundOutputs: ["o-1", "o-2"] });
    ask();
    fireEvent.click(await screen.findByRole("button", { name: /^Source: revenue/ }));
    await waitFor(() => expect(urls(http.get)).toContain("/api/outputs/o-1/provenance"));
    expect(urls(http.get).filter((u) => u.includes("/panels/"))).toEqual([]);
  });
});
