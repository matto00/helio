import { render, screen } from "@testing-library/react";

import { MessageTurn } from "./MessageTurn";

describe("MessageTurn", () => {
  // tasks.md 5.1 — a user turn and an assistant turn render with distinct alignment/surface
  // treatment, both built from DESIGN.md tokens.
  it("renders a user turn and an assistant turn with distinct alignment/surface classes", () => {
    const { container: userContainer } = render(<MessageTurn role="user" text="Hi there" />);
    const { container: assistantContainer } = render(
      <MessageTurn role="assistant" text="Hello! How can I help?" />,
    );

    const userBubble = userContainer.querySelector(".message-turn");
    const assistantBubble = assistantContainer.querySelector(".message-turn");

    expect(userBubble).toHaveClass("message-turn--user");
    expect(userBubble).not.toHaveClass("message-turn--assistant");
    expect(assistantBubble).toHaveClass("message-turn--assistant");
    expect(assistantBubble).not.toHaveClass("message-turn--user");

    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Assistant")).toBeInTheDocument();
    expect(screen.getByText("Hi there")).toBeInTheDocument();
    expect(screen.getByText("Hello! How can I help?")).toBeInTheDocument();
  });
});
