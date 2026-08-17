import type { FormEvent } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { Textarea } from "./Textarea";

describe("Textarea", () => {
  // F-063 — Enter-to-send is opt-in per consumer; every other Textarea keeps native
  // "Enter inserts a newline" behavior unless it explicitly asks for `submitOnEnter`.
  it("does not submit the form on Enter by default", () => {
    const onSubmit = jest.fn((e: FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Textarea aria-label="Message" />
      </form>,
    );

    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the nearest form on plain Enter when submitOnEnter is set", () => {
    const onSubmit = jest.fn((e: FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Textarea aria-label="Message" submitOnEnter />
      </form>,
    );

    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not submit on Shift+Enter when submitOnEnter is set -- newline behavior is preserved", () => {
    const onSubmit = jest.fn((e: FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Textarea aria-label="Message" submitOnEnter />
      </form>,
    );

    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not submit while an IME composition is in progress", () => {
    const onSubmit = jest.fn((e: FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Textarea aria-label="Message" submitOnEnter />
      </form>,
    );

    fireEvent.keyDown(screen.getByLabelText("Message"), {
      key: "Enter",
      isComposing: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still calls a caller-provided onKeyDown alongside the submit-on-enter behavior", () => {
    const onKeyDown = jest.fn();
    render(
      <form onSubmit={(e) => e.preventDefault()}>
        <Textarea aria-label="Message" submitOnEnter onKeyDown={onKeyDown} />
      </form>,
    );

    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});
