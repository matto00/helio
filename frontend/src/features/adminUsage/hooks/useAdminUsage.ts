import { useCallback, useEffect, useState } from "react";
import { isAxiosError } from "axios";

import { fetchAdminUsage } from "../services/adminUsageService";
import type { AdminUsage } from "../types/adminUsage";

type Status = "loading" | "succeeded" | "failed";

export interface UseAdminUsageResult {
  data: AdminUsage | null;
  status: Status;
  error: string | null;
  retry: () => void;
}

function errorMessage(err: unknown): string {
  if (isAxiosError(err) && err.response?.status === 403) {
    return "Owner access is required to view usage.";
  }
  if (isAxiosError(err) && typeof err.response?.data?.message === "string") {
    return err.response.data.message;
  }
  return "Failed to load usage.";
}

interface Settled {
  key: string;
  data: AdminUsage | null;
  error: string | null;
}

/** Fetches the aggregate usage view for a `days` window. Local state rather than a Redux slice:
 *  nothing else reads it, and it is refetched on every mount/window change. Loading is DERIVED
 *  (the last settled request's key differs from the current one), so there is no synchronous
 *  setState in the effect, and a stale response (window changed mid-flight) is dropped. The last
 *  good `data` stays available while the next window loads. */
export function useAdminUsage(days: number): UseAdminUsageResult {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [lastData, setLastData] = useState<AdminUsage | null>(null);
  const key = `${days}:${attempt}`;

  useEffect(() => {
    let cancelled = false;
    fetchAdminUsage(days)
      .then((result) => {
        if (cancelled) return;
        setLastData(result);
        setSettled({ key, data: result, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSettled({ key, data: null, error: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [days, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const current = settled?.key === key ? settled : null;
  const status: Status = current === null ? "loading" : current.error ? "failed" : "succeeded";
  return { data: current?.data ?? lastData, status, error: current?.error ?? null, retry };
}
