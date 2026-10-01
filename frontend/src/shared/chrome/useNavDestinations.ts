import { useAppSelector } from "../../hooks/reduxHooks";
import { adminUsageDestination, navDestinations, type NavDestination } from "./navDestinations";

/** The nav destinations for the signed-in user: the shared list, plus the owner-only Usage entry
 * when `tier === "owner"` (HEL-1211). One hook so the desktop sidebar and phone `BottomNav` can
 * never disagree about who sees it. */
export function useNavDestinations(): NavDestination[] {
  const isOwner = useAppSelector((state) => state.auth.currentUser?.tier === "owner");
  return isOwner ? [...navDestinations, adminUsageDestination] : navDestinations;
}
