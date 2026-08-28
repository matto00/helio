import { fireEvent, render, screen } from "@testing-library/react";

import { RunHistoryModal } from "./RunHistoryModal";
import type { PipelineRunRecord } from "../types/pipelineStep";

function setupDialog() {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
}

const emptyAssertions: PipelineRunRecord["assertions"] = {
  passed: 0,
  warnFailed: 0,
  errorFailed: 0,
  failures: [],
};

function makeRun(overrides: Partial<PipelineRunRecord> = {}): PipelineRunRecord {
  return {
    id: "run-1",
    pipelineId: "pipe-1",
    status: "succeeded",
    startedAt: "2026-05-01T10:00:00Z",
    completedAt: "2026-05-01T10:01:00Z",
    rowCount: 10,
    errorLog: null,
    triggerSource: "manual",
    assertions: emptyAssertions,
    ...overrides,
  };
}

beforeAll(() => {
  setupDialog();
});

describe("RunHistoryModal — HEL-576 assertion summary", () => {
  it("renders the pass/fail-by-severity summary for a run with assertion results", () => {
    const run = makeRun({
      assertions: {
        passed: 2,
        warnFailed: 0,
        errorFailed: 1,
        failures: [
          { kind: "notNull", field: "email", severity: "error", message: "null value found" },
        ],
      },
    });
    render(<RunHistoryModal runs={[run]} onClose={jest.fn()} />);

    expect(screen.getByText(/2 passed/)).toBeInTheDocument();
    expect(screen.getByText(/1 error/)).toBeInTheDocument();
  });

  it("renders no summary chip for a run with no assert steps (zero-valued summary)", () => {
    const run = makeRun({ assertions: emptyAssertions });
    render(<RunHistoryModal runs={[run]} onClose={jest.fn()} />);

    expect(screen.queryByText(/passed/)).not.toBeInTheDocument();
  });

  it("shows the expand toggle and reveals failing rules' messages for a succeeded run with assertion failures", () => {
    const run = makeRun({
      status: "succeeded",
      errorLog: null,
      assertions: {
        passed: 1,
        warnFailed: 1,
        errorFailed: 0,
        failures: [
          {
            kind: "rowCountMin",
            field: null,
            severity: "warn",
            message: "below minimum row count",
          },
        ],
      },
    });
    render(<RunHistoryModal runs={[run]} onClose={jest.fn()} />);

    expect(screen.queryByText("below minimum row count")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show log" }));

    expect(screen.getByText("rowCountMin")).toBeInTheDocument();
    expect(screen.getByText("below minimum row count")).toBeInTheDocument();
  });

  it("expanded body shows both the errorLog and the failing rules for a blocked run", () => {
    const run = makeRun({
      status: "failed",
      errorLog:
        "Run blocked: 1 error-severity assertion(s) failed — notNull(email): null value found",
      assertions: {
        passed: 0,
        warnFailed: 0,
        errorFailed: 1,
        failures: [
          { kind: "notNull", field: "email", severity: "error", message: "null value found" },
        ],
      },
    });
    render(<RunHistoryModal runs={[run]} onClose={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Show log" }));

    expect(screen.getByText(/Run blocked: 1 error-severity/)).toBeInTheDocument();
    expect(screen.getByText("notNull (email)")).toBeInTheDocument();
    expect(screen.getByText("null value found")).toBeInTheDocument();
  });

  it("does not show an expand toggle for a succeeded run with no errorLog and no assertion failures", () => {
    const run = makeRun({ status: "succeeded", errorLog: null, assertions: emptyAssertions });
    render(<RunHistoryModal runs={[run]} onClose={jest.fn()} />);

    expect(screen.queryByRole("button", { name: "Show log" })).not.toBeInTheDocument();
  });
});

describe("RunHistoryModal — HEL sweep F-159/F-137", () => {
  it("renders the shared EmptyState primitive (not ad-hoc text) when there are no runs", () => {
    render(<RunHistoryModal runs={[]} onClose={jest.fn()} />);

    expect(screen.getByText("No runs recorded yet")).toBeInTheDocument();
    expect(
      screen.getByText("Run or dry-run this pipeline to see its history here."),
    ).toBeInTheDocument();
  });

  it("renders a sentence-cased status label via the shared StatusChip (not the raw lowercase status)", () => {
    const run = makeRun({ status: "succeeded" });
    render(<RunHistoryModal runs={[run]} onClose={jest.fn()} />);

    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(screen.queryByText("succeeded")).not.toBeInTheDocument();
  });

  it("labels a dry_run row as sentence-case 'Dry run'", () => {
    const run = makeRun({ status: "dry_run" });
    render(<RunHistoryModal runs={[run]} onClose={jest.fn()} />);

    expect(screen.getByText("Dry run")).toBeInTheDocument();
  });
});
