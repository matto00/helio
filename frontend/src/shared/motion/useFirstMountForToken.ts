import { useEffect, useState } from "react";

const seen = new Map<string, Set<string>>();

/** Test-only: forgets every recorded token. */
export function resetFirstMountRegistryForTests(): void {
  seen.clear();
}

/** First mount per token (HEL-1584, DESIGN.md §10): true only when no component has yet observed `token` within `scope`,
 *  so an entrance tied to one data load plays at most once per load, across unmounts and remounts. The answer is decided
 *  at mount and latched (a token that changes under a mounted component does not flip it). Every token the component
 *  observes while mounted is recorded as seen, not only the one at mount, so a refetch under an on-screen surface does not
 *  make the next remount look new. The initializer is pure (it only reads), so StrictMode's double invocation agrees with
 *  itself; the recording happens in an effect. The registry is module-level and lives for the page's lifetime. */
export function useFirstMountForToken(scope: string, token: string): boolean {
  const [first] = useState(() => !seen.get(scope)?.has(token));
  useEffect(() => {
    let tokens = seen.get(scope);
    if (tokens === undefined) {
      tokens = new Set();
      seen.set(scope, tokens);
    }
    tokens.add(token);
  }, [scope, token]);
  return first;
}
