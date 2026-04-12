import { Navigate, Outlet } from "react-router-dom";

import { useAppSelector } from "../hooks/reduxHooks";

export function ProtectedRoute() {
  const status = useAppSelector((state) => state.auth.status);

  if (status === "idle" || status === "loading") {
    return (
      <div className="auth-loading" aria-label="Loading">
        <span className="auth-loading__spinner" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
