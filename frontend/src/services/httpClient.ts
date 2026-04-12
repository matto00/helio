import axios, { isAxiosError } from "axios";

export const httpClient = axios.create();

export function setAuthToken(token: string | null): void {
  if (token) {
    httpClient.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete httpClient.defaults.headers.common["Authorization"];
  }
}

/**
 * Wire up the global 401 interceptor. Must be called once after the Redux
 * store and router are available (i.e. in main.tsx).
 */
/* eslint-disable no-unused-vars */
export function setupAuthInterceptor(
  dispatch: (a: { type: string }) => void,
  navigate: (s: string) => void,
): void {
  /* eslint-enable no-unused-vars */
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
