import type { ReactNode } from "react";

import { useAppSelector } from "../../../hooks/reduxHooks";

interface OwnerOnlyProps {
  children: ReactNode;
  /** Rendered for anyone who is not an owner (the app's not-found page). */
  fallback: ReactNode;
}

/** Client-side convenience only: hides the owner admin route from non-owners. The real gate is the
 *  server's 403 on `GET /api/admin/usage`; nothing sensitive is rendered or fetched here. */
export function OwnerOnly({ children, fallback }: OwnerOnlyProps) {
  const tier = useAppSelector((state) => state.auth.currentUser?.tier);
  return <>{tier === "owner" ? children : fallback}</>;
}
