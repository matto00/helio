import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../test/renderWithStore";
import { SqlTab } from "./SqlTab";
import { inferSqlSource as inferSqlSourceService } from "../services/dataSourceService";
import type { InferredField } from "../types/models";

const noop = () => {};

jest.mock("../services/dataSourceService", () => ({
  ...jest.requireActual("../services/dataSourceService"),
  inferSqlSource: jest.fn(),
  createSqlSource: jest.fn(),
  fetchSources: jest.fn(),
}));

const mockInferSqlSource = jest.mocked(inferSqlSourceService);

describe("SqlTab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Port defaults by dialect (task 6.4) ──────────────────────────────────

  it("defaults port to 5432 when PostgreSQL is selected", () => {
    renderWithStore(<SqlTab name="Test Source" onSave={noop} isSaving={false} />);
    const portInput = screen.getByLabelText("Port") as HTMLInputElement;
    expect(portInput.value).toBe("5432");
  });

  it("changes port to 3306 when MySQL dialect is selected", () => {
    renderWithStore(<SqlTab name="Test Source" onSave={noop} isSaving={false} />);

    fireEvent.click(screen.getByRole("button", { name: "MySQL" }));

    const portInput = screen.getByLabelText("Port") as HTMLInputElement;
    expect(portInput.value).toBe("3306");
  });

  it("changes port back to 5432 when PostgreSQL dialect is selected after MySQL", () => {
    renderWithStore(<SqlTab name="Test Source" onSave={noop} isSaving={false} />);

    fireEvent.click(screen.getByRole("button", { name: "MySQL" }));
    fireEvent.click(screen.getByRole("button", { name: "PostgreSQL" }));

    const portInput = screen.getByLabelText("Port") as HTMLInputElement;
    expect(portInput.value).toBe("5432");
  });

  // ── Test connection success (task 6.5) ────────────────────────────────────

  it("shows inferred fields on successful test connection", async () => {
    const fields: InferredField[] = [
      { name: "id", displayName: "Id", dataType: "integer", nullable: false },
      { name: "name", displayName: "Name", dataType: "string", nullable: true },
    ];
    mockInferSqlSource.mockResolvedValue(fields);

    renderWithStore(<SqlTab name="Test Source" onSave={noop} isSaving={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByText(/Connection successful/i)).toBeInTheDocument();
    });

    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
  });

  // ── Test connection failure (task 6.5) ────────────────────────────────────

  it("shows inline error on test connection failure", async () => {
    mockInferSqlSource.mockRejectedValue(
      new Error("Connection refused: could not connect to server"),
    );

    renderWithStore(<SqlTab name="Test Source" onSave={noop} isSaving={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    expect(screen.getByRole("alert").textContent).toMatch(/Connection refused|Failed to connect/i);
  });

  // ── Password field is masked ──────────────────────────────────────────────

  it("renders password field as type=password", () => {
    renderWithStore(<SqlTab name="Test Source" onSave={noop} isSaving={false} />);
    const passwordInput = screen.getByLabelText("Password") as HTMLInputElement;
    expect(passwordInput.type).toBe("password");
  });

  // ── Create source button disabled until test connection passes ────────────

  it("disables Create source button until test connection is run", () => {
    renderWithStore(<SqlTab name="Test Source" onSave={noop} isSaving={false} />);
    const createBtn = screen.getByRole("button", { name: "Create source" });
    expect(createBtn).toBeDisabled();
  });
});
