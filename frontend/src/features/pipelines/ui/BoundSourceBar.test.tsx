import { fireEvent, render, screen } from "@testing-library/react";
import { BoundSourceBar } from "./BoundSourceBar";
import type { DataSource } from "../../sources/types/dataSource";

const sqlSource: DataSource = {
  id: "src-1",
  name: "Test Source",
  type: "sql",
  createdAt: "",
  updatedAt: "",
  config: {
    dialect: "postgresql",
    host: "h",
    port: 5432,
    database: "d",
    user: "u",
    password: "p",
    query: "SELECT 1",
  },
};

describe("BoundSourceBar", () => {
  it("renders the Edit Source button when canEditSource is true", () => {
    render(
      <BoundSourceBar
        sourceName="Test Source"
        source={sqlSource}
        canEditSource={true}
        onEditSource={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Edit Source" })).toBeInTheDocument();
  });

  it("calls onEditSource when the Edit Source button is clicked", () => {
    const onEditSource = jest.fn();
    render(
      <BoundSourceBar
        sourceName="Test Source"
        source={sqlSource}
        canEditSource={true}
        onEditSource={onEditSource}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Source" }));
    expect(onEditSource).toHaveBeenCalledTimes(1);
  });

  it("does not render the Edit Source button when canEditSource is false", () => {
    render(
      <BoundSourceBar
        sourceName="Test Source"
        source={undefined}
        canEditSource={false}
        onEditSource={jest.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Edit Source" })).not.toBeInTheDocument();
  });
});
