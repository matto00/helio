import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAppSelector } from "../../../hooks/reduxHooks";
import { returnPathFromState } from "../utils/postLoginReturnTo";

export function PublicOnlyRoute() {
  const status = useAppSelector((state) => state.auth.status);
  const location = useLocation();

  if (status === "authenticated") {
    // HEL-1709: a visitor bounced here from a protected deep link (state.from, carried through
    // /login -> /login/verify) goes back to it, so the redirect cannot beat the page's own
    // navigation to /home on the instant the session appears.
    return <Navigate to={returnPathFromState(location.state) ?? "/home"} replace />;
  }

  return <Outlet />;
}
