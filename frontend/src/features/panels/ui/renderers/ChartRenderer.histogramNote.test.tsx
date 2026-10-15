import { render, screen } from "@testing-library/react";

import { defaultChartAppearance, defaultPanelAppearance } from "../../../../theme/appearance";
import { ThemeProvider } from "../../../../theme/ThemeProvider";
import { settleChartMount } from "../../../../test/settleChartMount";
import { ChartRenderer, histogramSkippedNote } from "./ChartRenderer";

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: () => <div data-testid="echarts" />,
}));

const headers = ["ms"];
// 10 numbers, 2 blanks and one "n/a".
const rawRows = [..."0123456789"].map((d) => [d]).concat([[""], [""], ["n/a"]]);

function renderHistogram(chartType: "histogram" | "bar", truncationNote?: string) {
  return render(
    <ThemeProvider>
      <ChartRenderer
        appearance={{
          ...defaultPanelAppearance,
          chart: { ...defaultChartAppearance, chartType },
        }}
        headers={headers}
        rawRows={rawRows}
        fieldMapping={{ xAxis: "ms" }}
        truncationNote={truncationNote}
      />
    </ThemeProvider>,
  );
}

describe("ChartRenderer histogram skipped-values note (HEL-1311)", () => {
  it("states how many blank / non-numeric values were skipped", async () => {
    renderHistogram("histogram");
    await settleChartMount();
    screen.getByTestId("echarts");
    expect(screen.getByText("3 non-numeric values skipped.")).toBeInTheDocument();
  });

  it("shows both notes, the skipped one second, when the rows are also truncated", async () => {
    const { container } = renderHistogram("histogram", "Based on the first 200 of 1,000 rows.");
    await settleChartMount();
    screen.getByTestId("echarts");
    const notes = [...container.querySelectorAll(".chart-panel__truncation-note")].map(
      (n) => n.textContent,
    );
    expect(notes).toEqual([
      "Based on the first 200 of 1,000 rows.",
      "3 non-numeric values skipped.",
    ]);
  });

  it("shows no skipped note for another chart type", async () => {
    renderHistogram("bar");
    await settleChartMount();
    screen.getByTestId("echarts");
    expect(screen.queryByText(/non-numeric/)).not.toBeInTheDocument();
  });

  it("formats the note", () => {
    expect(histogramSkippedNote(0)).toBeNull();
    expect(histogramSkippedNote(1)).toBe("1 non-numeric value skipped.");
  });
});
