import { fireEvent, render, screen } from "@testing-library/react";

import { SchemaFieldViewer } from "./SchemaFieldViewer";

interface Field {
  name: string;
}

function field(name: string): Field {
  return { name };
}

const getName = (f: Field) => f.name;

function renderChipViewer(
  fields: Field[],
  props: Partial<Parameters<typeof SchemaFieldViewer<Field>>[0]> = {},
) {
  return render(
    <SchemaFieldViewer
      title="Schema"
      fields={fields}
      getName={getName}
      renderField={(f) => <span data-testid={`chip-${f.name}`}>{f.name}</span>}
      fieldsContainer={(children) => <div data-testid="chip-row">{children}</div>}
      {...props}
    />,
  );
}

describe("SchemaFieldViewer — small count (no chrome)", () => {
  it("renders NO header, count, search box, or grouping at or below the small threshold", () => {
    const fields = Array.from({ length: 5 }, (_, i) => field(`f${i}`));
    renderChipViewer(fields, { smallThreshold: 12 });

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/fields$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    fields.forEach((f) => expect(screen.getByTestId(`chip-${f.name}`)).toBeInTheDocument());
  });
});

describe("SchemaFieldViewer — grouped namespaces", () => {
  const fields = [
    ...Array.from({ length: 3 }, (_, i) => field(`a.f${i}`)),
    ...Array.from({ length: 3 }, (_, i) => field(`b.f${i}`)),
  ];

  it("shows the total count and both namespace groups collapsed by default", () => {
    renderChipViewer(fields, { smallThreshold: 2, groupCap: 20 });

    expect(screen.getByText("6 fields")).toBeInTheDocument();
    const toggles = screen.getAllByRole("button", { name: /^[ab]\s/ });
    expect(toggles).toHaveLength(2);
    toggles.forEach((t) => expect(t).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByTestId("chip-a.f0")).not.toBeInTheDocument();
  });

  it("expands a group via its toggle button, revealing its fields with correct aria-expanded", () => {
    renderChipViewer(fields, { smallThreshold: 2, groupCap: 20 });

    const groupA = screen.getByRole("button", { name: /^a\s/ });
    fireEvent.click(groupA);

    expect(groupA).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("chip-a.f0")).toBeInTheDocument();
    expect(screen.queryByTestId("chip-b.f0")).not.toBeInTheDocument();
  });

  it("caps an expanded group's rendered fields and offers Show all N", () => {
    const many = Array.from({ length: 30 }, (_, i) => field(`a.f${i}`)).concat(field("b.only"));
    renderChipViewer(many, { smallThreshold: 2, groupCap: 20 });

    fireEvent.click(screen.getByRole("button", { name: /^a\s/ }));
    expect(screen.getByTestId("chip-a.f0")).toBeInTheDocument();
    expect(screen.queryByTestId("chip-a.f20")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all 30" }));
    expect(screen.getByTestId("chip-a.f20")).toBeInTheDocument();
  });
});

describe("SchemaFieldViewer — filtering", () => {
  const fields = [
    ...Array.from({ length: 3 }, (_, i) => field(`a.matchme${i}`)),
    ...Array.from({ length: 3 }, (_, i) => field(`b.matchme${i}`)),
    ...Array.from({ length: 3 }, (_, i) => field(`c.other${i}`)),
  ];

  it("filters across every namespace and shows matches flat (not still grouped)", () => {
    renderChipViewer(fields, { smallThreshold: 2, groupCap: 20 });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "matchme" } });

    expect(screen.queryByRole("button", { name: /^a\s/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("chip-a.matchme0")).toBeInTheDocument();
    expect(screen.getByTestId("chip-b.matchme0")).toBeInTheDocument();
    expect(screen.queryByTestId("chip-c.other0")).not.toBeInTheDocument();
  });

  it("shows an empty-results message when nothing matches", () => {
    renderChipViewer(fields, { smallThreshold: 2, groupCap: 20 });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz-no-match" } });
    expect(screen.getByText(/No fields match/)).toBeInTheDocument();
  });

  it("gives the filter input an accessible name derived from the title", () => {
    renderChipViewer(fields, { smallThreshold: 2, groupCap: 20 });
    expect(screen.getByRole("searchbox", { name: /filter schema by name/i })).toBeInTheDocument();
  });
});

describe("SchemaFieldViewer — table presentation via fieldsContainer", () => {
  it("lets a caller render fields as real <tr>s inside its own <table>/<thead>", () => {
    const fields = Array.from({ length: 15 }, (_, i) => field(`col${i}`));
    render(
      <SchemaFieldViewer
        title="Schema"
        fields={fields}
        getName={getName}
        smallThreshold={2}
        groupCap={20}
        renderField={(f) => (
          <tr key={f.name}>
            <td>{f.name}</td>
          </tr>
        )}
        fieldsContainer={(children) => (
          <table>
            <thead>
              <tr>
                <th>Field</th>
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        )}
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Field" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(fields.length + 1); // + header row
  });
});
