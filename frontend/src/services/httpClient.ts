import axios, { isAxiosError } from "axios";
import { API_BASE_URL } from "../config/env";

// HEL-287 CodeQL #8: session identity moved from a bearer token in
// sessionStorage + a manual Authorization header to an HttpOnly cookie set
// by the backend. `withCredentials: true` sends/receives that cookie on
// every request (required since prod's frontend/backend are genuinely
// cross-site — see design.md D1). The custom header is the CSRF defense for
// state-changing requests once the cookie can be sent cross-site (design.md
// D4); harmless to send on GET.
export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    "X-Helio-Requested-With": "1",
  },
});

/**
 * Wire up the global 401 interceptor. Must be called once after the Redux
 * store and router are available (i.e. in main.tsx).
 */
export function setupAuthInterceptor(
  dispatch: (a: { type: string }) => void,
  navigate: (s: string) => void,
): void {
  httpClient.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      if (isAxiosError(error) && error.response?.status === 401) {
        const url = error.config?.url ?? "";
        // Skip redirect loop on the rehydration call itself
        if (!url.includes("/api/auth/me")) {
          dispatch({ type: "auth/clearAuth" });
          navigate("/login");
        }
      }
      return Promise.reject(error);
    },
  );
}
