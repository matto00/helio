import { act, render, screen } from "@testing-library/react";

import { useOneShotOnChange } from "./useOneShot";

const toFailed = (next: string) => next === "failed";

function Mark({ status }: { status: string }) {
  const { active, done } = useOneShotOnChange(status, toFailed);
  return (
    <button data-testid="mark" data-active={active} onClick={done}>
      {status}
    </button>
  );
}
const active = () => screen.getByTestId("mark").getAttribute("data-active");

describe("useOneShotOnChange", () => {
  it("never fires on mount, even when mounted in the target state", () => {
    render(<Mark status="failed" />);
    expect(active()).toBe("false");
  });

  it("fires once on a change into the target state, in the same commit", () => {
    const { rerender } = render(<Mark status="running" />);
    rerender(<Mark status="failed" />);
    expect(active()).toBe("true");
    rerender(<Mark status="failed" />);
    expect(active()).toBe("true");
  });

  it("resets after done, and does not fire again until the value changes into the target once more", () => {
    const { rerender } = render(<Mark status="running" />);
    rerender(<Mark status="failed" />);
    act(() => screen.getByTestId("mark").click());
    expect(active()).toBe("false");
    rerender(<Mark status="failed" />);
    expect(active()).toBe("false");
    rerender(<Mark status="running" />);
    rerender(<Mark status="failed" />);
    expect(active()).toBe("true");
  });

  it("ends at the next change that is not into the target", () => {
    const { rerender } = render(<Mark status="running" />);
    rerender(<Mark status="failed" />);
    rerender(<Mark status="succeeded" />);
    expect(active()).toBe("false");
  });

  it("passes the previous value, so a counter can target an increase", () => {
    function Counter({ n }: { n: number }) {
      const { active: on } = useOneShotOnChange(n, (next, prev) => next > prev);
      return <span data-testid="c" data-active={on} />;
    }
    const { rerender } = render(<Counter n={1} />);
    rerender(<Counter n={2} />);
    expect(screen.getByTestId("c").getAttribute("data-active")).toBe("true");
    rerender(<Counter n={0} />);
    expect(screen.getByTestId("c").getAttribute("data-active")).toBe("false");
  });
});
