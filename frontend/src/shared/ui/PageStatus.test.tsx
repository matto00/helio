import { fireEvent, render, screen } from "@testing-library/react";

import { PageStatus } from "./PageStatus";

describe("PageStatus", () => {
  it("renders the accent spinner pattern for status=loading", () => {
    render(<PageStatus status="loading" loadingLabel="Loading sources" />);

    expect(screen.getByRole("status", { name: "Loading sources" })).toBeInTheDocument();
  });

  it("renders the caller's own skeleton for variant=skeleton", () => {
    render(
      <PageStatus status="loading" variant="skeleton">
        <div data-testid="custom-skeleton" />
      </PageStatus>,
    );

    expect(screen.getByTestId("custom-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders an intent-error EmptyState with a Retry cta when onRetry is given", () => {
    const onRetry = jest.fn();
    render(<PageStatus status="failed" message="Could not load." onRetry={onRetry} />);

    const cta = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(cta);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Could not load.")).toBeInTheDocument();
  });

  it("renders no cta when onRetry is not given", () => {
    render(<PageStatus status="failed" message="Could not load." />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables and relabels the cta to Retrying… while retrying", () => {
    render(
      <PageStatus status="failed" message="Could not load." onRetry={() => {}} retrying={true} />,
    );

    const cta = screen.getByRole("button", { name: "Retrying…" });
    expect(cta).toBeDisabled();
  });
});
