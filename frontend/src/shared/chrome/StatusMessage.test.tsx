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

  // HEL-528 design.md D5 — "loading" is no longer in the `status` prop's
  // type at all: a call site that still passes it fails to COMPILE, not
  // just render nothing. `@ts-expect-error` locks that at the type level —
  // if this ever stops erroring (the type quietly widened back), the build
  // fails here instead of silently reopening the dead-code risk D5 closes.
  it("a loading status is not assignable (compile-time check)", () => {
    // @ts-expect-error — "loading" removed from StatusMessageProps["status"] (D5)
    render(<StatusMessage status="loading" />);
  });

  it("failed state carries role=alert and pairs an icon with the message text", () => {
    render(<StatusMessage status="failed" message="Something broke." />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something broke.");
    expect(alert.querySelector("svg")).toBeInTheDocument();
    expect(alert).toHaveClass("status-message", "status-message--error");
  });

  it("the failed state carries the base status-message class (box metrics)", () => {
    const { container: failedContainer } = render(
      <StatusMessage status="failed" message="Failed." />,
    );
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
// solely owned by the shared `.status-message` base rule (HEL-528: now the
// only status this component renders any content for).
describe("StatusMessage.css — failed box metrics stay on the shared base rule (D4)", () => {
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
