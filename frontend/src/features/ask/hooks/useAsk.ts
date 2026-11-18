import { useCallback, useEffect, useRef, useState } from "react";

import { parseAskError } from "../parseAskError";
import { askDashboard, askOutput } from "../services/askService";
import type { AskScope, AskState } from "../types/ask";

export const ASK_MAX_QUESTION = 2000;

/** Trimmed question length is in 1..2000 (the server's bound). */
export function isAskableQuestion(question: string): boolean {
  const n = question.trim().length;
  return n >= 1 && n <= ASK_MAX_QUESTION;
}

/** The ask lifecycle of ONE surface (idle -> pending -> answered | error). Local state: nothing else reads it and the server
 *  persists nothing. A response that arrives after a newer ask (or after unmount or a scope change) is dropped. */
export function useAsk(scope: AskScope) {
  const scopeKey = `${scope.kind}:${scope.id}`;
  // The state is held with the scope it belongs to, so a scope change reads as idle with no effect-driven reset.
  const [held, setHeld] = useState<{ key: string; state: AskState }>({
    key: scopeKey,
    state: { status: "idle" },
  });
  const state: AskState = held.key === scopeKey ? held.state : { status: "idle" };
  const latest = useRef(0);
  const lastQuestion = useRef<string | null>(null);

  useEffect(
    () => () => {
      latest.current += 1;
    },
    [scopeKey],
  );
  useEffect(() => {
    lastQuestion.current = null;
  }, [scopeKey]);

  const ask = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!isAskableQuestion(question)) return;
      lastQuestion.current = question;
      const ticket = ++latest.current;
      setHeld({ key: scopeKey, state: { status: "pending", question } });
      try {
        const response = await (scope.kind === "dashboard"
          ? askDashboard(scope.id, question)
          : askOutput(scope.id, question));
        if (ticket === latest.current)
          setHeld({ key: scopeKey, state: { status: "answered", question, response } });
      } catch (err) {
        if (ticket === latest.current)
          setHeld({
            key: scopeKey,
            state: { status: "error", question, error: parseAskError(err) },
          });
      }
    },
    [scope.kind, scope.id, scopeKey],
  );

  /** Re-sends the same question as the last ask. */
  const retry = useCallback(() => {
    if (lastQuestion.current !== null) void ask(lastQuestion.current);
  }, [ask]);

  return { state, ask, retry };
}
