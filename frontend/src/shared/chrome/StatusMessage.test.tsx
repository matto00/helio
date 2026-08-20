import fs from "fs";
import path from "path";
import { fireEvent, render, screen } from "@testing-library/react";

import { StatusMessage } from "./StatusMessage";

describe("StatusMessage", () => {
  it("renders nothing for idle/succeeded", () => {
    const { container: idleContainer } = render(<StatusMessage status="idle" />);
    expect(idleContainer).toBeEmptyDOMElement();

    const { container: succeededContainer } = render(<StatusMessage status="succeeded" />);
    expect(succeededContainer).toBeEmptyDOMElement();
  });

  it("renders the default loading message with no role", () => {
    render(<StatusMessage status="loading" />);
    const el = screen.getByText("Loading...");
    expect(el).toHaveClass("status-message");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("failed state carries role=alert and pairs an icon with the message text", () => {
    render(<StatusMessage status="failed" message="Something broke." />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something broke.");
    expect(alert.querySelector("svg")).toBeInTheDocument();
    expect(alert).toHaveClass("status-message", "status-message--error");
  });

  it("both loading and failed share the base status-message class carrying box metrics", () => {
    const { container: loadingContainer } = render(
      <StatusMessage status="loading" message="Loading panels..." />,
    );
    const { container: failedContainer } = render(
      <StatusMessage status="failed" message="Failed." />,
    );
    expect(loadingContainer.firstChild).toHaveClass("status-message");
    expect(failedContainer.firstChild).toHaveClass("status-message");
  });

  it("renders a retry action invoking onRetry when provided on failed", () => {
    const onRetry = jest.fn();
    render(<StatusMessage status="failed" message="Failed." onRetry={onRetry} />);
    const btn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders no retry action when onRetry is absent on failed", () => {
    render(<StatusMessage status="failed" message="Failed." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("retrying disables the retry button and swaps its label", () => {
    const onRetry = jest.fn();
    render(<StatusMessage status="failed" message="Failed." onRetry={onRetry} retrying />);
    const btn = screen.getByRole("button", { name: "Retrying…" });
    expect(btn).toBeDisabled();
  });

  it("non-failed states never render a retry action, even if onRetry/retrying are passed", () => {
    const onRetry = jest.fn();
    render(<StatusMessage status="loading" onRetry={onRetry} retrying />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    const { container } = render(<StatusMessage status="idle" onRetry={onRetry} />);
    expect(container).toBeEmptyDOMElement();

    const { container: succeededContainer } = render(
      <StatusMessage status="succeeded" onRetry={onRetry} />,
    );
    expect(succeededContainer).toBeEmptyDOMElement();
  });
});

// HEL-539 design.md D4 — the failed state gained an icon/role/retry, but must
// NOT change its existing box metrics (padding, type size, radius): jsdom
// doesn't apply external stylesheets, so this asserts directly against the
// CSS source (mirrors EmptyState.css.test.ts's precedent) that
// `.status-message--error` never redeclares those properties — they stay
// solely owned by the shared `.status-message` base rule both `loading` and
// `failed` render through.
describe("StatusMessage.css — failed box metrics stay paired with loading (D4)", () => {
  const CSS_PATH = path.join(__dirname, "StatusMessage.css");
  const css = fs.readFileSync(CSS_PATH, "utf-8");

  it(".status-message--error does not override padding/font-size/border-radius", () => {
    const ruleStart = css.indexOf(".status-message--error {");
    expect(ruleStart).toBeGreaterThan(-1);
    const ruleEnd = css.indexOf("}", ruleStart);
    const body = css.slice(ruleStart, ruleEnd);
    expect(body).not.toMatch(/(?<!border-)padding\s*:/);
    expect(body).not.toMatch(/font-size\s*:/);
    expect(body).not.toMatch(/border-radius\s*:/);
  });
});
