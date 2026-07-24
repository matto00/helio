import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { TestConnectionAffordance } from "./TestConnectionAffordance";
import { testConnection as testConnectionRequest } from "../services/dataSourceService";
import type { SqlSourceConfig } from "../services/dataSourceService";

jest.mock("../services/dataSourceService", () => ({
  ...jest.requireActual("../services/dataSourceService"),
  testConnection: jest.fn(),
}));

const mockTestConnection = jest.mocked(testConnectionRequest);

const sqlConfig: SqlSourceConfig = {
  dialect: "postgresql",
  host: "localhost",
  port: 5432,
  database: "db",
  user: "user",
  password: "pw",
  query: "SELECT 1",
};

describe("TestConnectionAffordance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders idle with just the button", () => {
    render(<TestConnectionAffordance type="sql" buildConfig={() => sqlConfig} />);
    expect(screen.getByRole("button", { name: "Test connection" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("goes idle -> pending -> success", async () => {
    let resolvePromise: (value: { ok: boolean; error: string | null }) => void = () => {};
    mockTestConnection.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      }),
    );

    render(<TestConnectionAffordance type="sql" buildConfig={() => sqlConfig} />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    const button = await screen.findByRole("button", { name: "Testing…" });
    expect(button).toBeDisabled();

    resolvePromise({ ok: true, error: null });

    await waitFor(() => {
      expect(screen.getByText(/Connected/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Test connection" })).not.toBeDisabled();
    expect(mockTestConnection).toHaveBeenCalledWith("sql", sqlConfig);
  });

  it("goes idle -> pending -> error, rendering the curated message via InlineError", async () => {
    mockTestConnection.mockResolvedValue({ ok: false, error: "SQL connection failed" });

    render(<TestConnectionAffordance type="sql" buildConfig={() => sqlConfig} />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByText("SQL connection failed")).toBeInTheDocument();
    });
    expect(screen.getByText("SQL connection failed")).toHaveClass("inline-error");
    expect(screen.queryByText(/Connected/)).not.toBeInTheDocument();
  });

  // Regression (HEL-613 pattern): the wire response omits `error` entirely on
  // success — the service layer normalizes this to `null`, and the
  // component must never render "undefined" or throw when the mock
  // constructs the fixture with the key genuinely absent (not `null`).
  it("renders the success state, not a broken error, when the service layer's result omits the error key", async () => {
    mockTestConnection.mockResolvedValue({ ok: true } as { ok: boolean; error: string | null });

    render(<TestConnectionAffordance type="rest_api" buildConfig={() => ({ url: "https://x" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByText(/Connected/)).toBeInTheDocument();
    });
    expect(screen.queryByText("undefined")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("respects the disabled prop", () => {
    render(<TestConnectionAffordance type="sql" buildConfig={() => sqlConfig} disabled />);
    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
  });
});
