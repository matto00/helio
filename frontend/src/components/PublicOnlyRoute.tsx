import { Navigate, Outlet } from "react-router-dom";

import { useAppSelector } from "../hooks/reduxHooks";

export function PublicOnlyRoute() {
  const status = useAppSelector((state) => state.auth.status);

  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
