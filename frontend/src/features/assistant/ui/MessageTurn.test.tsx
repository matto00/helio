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

  // HEL-667 design.md D5/tasks.md 6.2/7.5 — a distinct treatment for a hop-cap-exhausted turn.
  it("renders a distinct hop-budget-exhausted treatment when the prop is true", () => {
    const { container } = render(
      <MessageTurn role="assistant" text="Reached the limit." hopBudgetExhausted />,
    );

    expect(container.querySelector(".message-turn--hop-budget-exhausted")).toBeInTheDocument();
    expect(container.querySelector(".message-turn--searched-no-results")).not.toBeInTheDocument();
    expect(screen.getByText("Couldn't finish in time")).toBeInTheDocument();
  });

  // HEL-667 design.md D5/tasks.md 6.2/7.5 — a distinct treatment for a no-results/clarifying-
  // question turn.
  it("renders a distinct searched-with-no-results treatment when the prop is true", () => {
    const { container } = render(
      <MessageTurn role="assistant" text="Can you narrow that down?" searchedWithNoResults />,
    );

    expect(container.querySelector(".message-turn--searched-no-results")).toBeInTheDocument();
    expect(container.querySelector(".message-turn--hop-budget-exhausted")).not.toBeInTheDocument();
    expect(screen.getByText("Asking a follow-up")).toBeInTheDocument();
  });

  // HEL-667 design.md D5/tasks.md 7.5 — the unaffected-normal-turn case: neither prop set (or both
  // explicitly false) renders the existing, undecorated treatment.
  it("renders the plain, undecorated treatment when neither outcome prop is set", () => {
    const { container } = render(<MessageTurn role="assistant" text="Here's your answer." />);

    expect(container.querySelector(".message-turn--hop-budget-exhausted")).not.toBeInTheDocument();
    expect(container.querySelector(".message-turn--searched-no-results")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't finish in time")).not.toBeInTheDocument();
    expect(screen.queryByText("Asking a follow-up")).not.toBeInTheDocument();
  });
});
