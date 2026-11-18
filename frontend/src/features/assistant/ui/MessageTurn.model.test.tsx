import { render, screen } from "@testing-library/react";

import { MessageTurn } from "./MessageTurn";

describe("MessageTurn model label (HEL-1755)", () => {
  it("shows the muted model label when one is passed", () => {
    render(<MessageTurn role="assistant" text="Hi" modelLabel="Haiku 5.5" />);
    expect(screen.getByTestId("message-turn-model")).toHaveTextContent("Haiku 5.5");
  });

  it("shows no label by default", () => {
    render(<MessageTurn role="assistant" text="Hi" />);
    expect(screen.queryByTestId("message-turn-model")).not.toBeInTheDocument();
  });
});
