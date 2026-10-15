import { act } from "@testing-library/react";

/** A jest mock whose recorded results (usually promises) the chart mount causally depends on. */
interface MockSource {
  mock: { results: Array<{ value: unknown }> };
}

type Source = MockSource | PromiseLike<unknown>;

/**
 * Wait for a lazily mounted chart without a wall-clock deadline.
 *
 * `ChartRenderer` lazy-loads `ChartPanel`, so the chart only exists after the data it depends on has
 * resolved (for example `getOutputById`'s output-meta promise) and the lazy module has loaded.
 * Polling for it with `findBy*` races RTL's fixed 1 s deadline against main-thread work of unknown
 * length: a stall of about 1 s on a busy runner makes the overdue timeout fire before React's next
 * commit, so the test fails although nothing is wrong (HEL-1596 reproduced this with an injected
 * stall). Instead, await the causal events themselves inside `act` so React flushes the resulting
 * updates, then let the caller query synchronously with `getBy*`.
 *
 * Pass every mock whose results gate the chart (all of its recorded results are awaited) and/or any
 * plain promise. With no argument only the lazy module is awaited. Under a test file that mocks
 * `./ChartPanel` this resolves that mock, which is the module the lazy import gates on in that file.
 */
export async function settleChartMount(...sources: Source[]): Promise<void> {
  await act(async () => {
    await Promise.all(collectPending(sources));
    await import("../features/panels/ui/ChartPanel");
  });
}

/**
 * Wait for content that is NOT behind the lazy chart boundary (truncation note, table, metric,
 * form, markdown) without a wall-clock deadline (HEL-1612; same mechanism as `settleChartMount`).
 *
 * A `findBy*` for such content races RTL's fixed 1 s deadline against the output meta, rows and
 * history mock promises: a main-thread stall of about 1 s that lands after the wait armed its
 * timer, before React commits the resolved data, fails the test although nothing is wrong. Await
 * the causal promises inside `act` instead, so React flushes the resulting updates, then query
 * synchronously with `getBy*`.
 *
 * Pass every mock whose recorded results gate the target (all are awaited) and/or any plain
 * promise. A lazy non-chart target is settled by passing its module promise explicitly, for
 * example `import("./MarkdownPanel")`. Where a request is issued only after an earlier one
 * resolved and React flushed, call this once per stage. A mock that returns a rejecting promise
 * (a stubbed failure) is tolerated: every source is awaited to settlement, never rethrown.
 */
export async function settleMocks(...sources: Source[]): Promise<void> {
  await act(async () => {
    await Promise.allSettled(collectPending(sources));
  });
}

function collectPending(sources: Source[]): unknown[] {
  return sources.flatMap((source) =>
    "mock" in source ? source.mock.results.map((result) => result.value) : [source],
  );
}
