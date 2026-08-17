import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAppSelector } from "../../../hooks/reduxHooks";
import { Spinner } from "../../../shared/ui/Spinner";

export function ProtectedRoute() {
  const status = useAppSelector((state) => state.auth.status);
  const location = useLocation();

  if (status === "idle" || status === "loading") {
    return (
      <div className="auth-loading" aria-label="Loading">
        <Spinner size="2xl" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    // F-081: carries the deep link the visitor was on so LoginPage can send
    // them back to it after a successful sign-in, instead of always landing
    // on the dashboards home.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
