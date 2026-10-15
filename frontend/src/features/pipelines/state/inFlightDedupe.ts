// inFlightDedupe -- HEL-1579 (design.md D8): a page-scoped, in-flight-ONLY request dedupe. A second
// request for a key whose request is still in flight joins it (enough for StrictMode's double effect);
// once a request settles it is forgotten, so a settled response is never reused and every selection
// fetches fresh (re-selecting a step after editing an upstream step must not show stale rows).

export interface InFlightDedupe {
  run: <T>(key: string, start: () => Promise<T>) => Promise<T>;
}

export function createInFlightDedupe(): InFlightDedupe {
  const inFlight = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, start: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing !== undefined) return existing as Promise<T>;
      const promise: Promise<T> = start().finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });
      inFlight.set(key, promise);
      return promise;
    },
  };
}
