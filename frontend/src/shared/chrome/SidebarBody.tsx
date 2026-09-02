import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Database, GitBranch, Pencil, Pin, PinOff } from "lucide-react";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faComments, faLock } from "@fortawesome/free-solid-svg-icons";

import {
  fetchConversations,
  renameConversation,
  setSelectedConversationId,
  startNewConversation,
  TierRequestAccessCopy,
  togglePinned,
} from "../../features/assistant/state/assistantConversationsSlice";
import {
  deletePipeline,
  fetchPipelines,
  setCreatePipelineModalOpen,
} from "../../features/pipelines/state/pipelinesSlice";
import {
  deleteSource,
  fetchSources,
  setAddSourceModalOpen,
} from "../../features/sources/state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import { DashboardList } from "../../features/dashboards/ui/DashboardList";
import "./SidebarBody.css";
import { pickerIdForPathname } from "./sections";
import { SidebarItemList, type SidebarItem } from "./SidebarItemList";

/** Picks the section-appropriate list based on the current route. The dashboards
 * section keeps DashboardList (full CRUD); other sections use the lighter
 * SidebarItemList (filter + navigate). All sections render a list when their
 * route is active so the sidebar is consistent across sections. */
export function SidebarBody() {
  const { pathname } = useLocation();
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const sources = useAppSelector((state) => state.sources);
  const pipelines = useAppSelector((state) => state.pipelines);
  const conversations = useAppSelector((state) => state.assistantConversations);
  const currentUser = useAppSelector((state) => state.auth.currentUser);

  const section = pickerIdForPathname(pathname);
  // HEL-703 design.md D9 (cycle-2 evaluator CR1) — mirrors `ChatPage.tsx`/`QuickLauncherOverlay.tsx`'s
  // own guard: this was the one `fetchConversations()` dispatch site those two missed, since the
  // sidebar's "chat" section list is driven from here, not from either of those components.
  const isFreeTier = currentUser?.tier === "free";

  useEffect(() => {
    if (section === "sources" && sources.status === "idle") {
      void dispatch(fetchSources());
    } else if (section === "pipelines" && pipelines.status === "idle") {
      void dispatch(fetchPipelines());
    } else if (section === "chat" && !isFreeTier && conversations.status === "idle") {
      void dispatch(fetchConversations());
    }
    // The sources section also needs pipelines loaded: the delete-confirm
    // warning counts pipelines that read from the source being deleted.
    if (section === "sources" && pipelines.status === "idle") {
      void dispatch(fetchPipelines());
    }
  }, [section, dispatch, sources.status, pipelines.status, conversations.status, isFreeTier]);

  if (section === "sources") {
    // Route-driven, like the pipelines and metrics branches below: `/sources`
    // is now a section overview and `/sources/:id` the detail, so the URL is
    // the selection. This replaces a Redux `selectedSourceId` + "fall back to
    // items[0]" pairing, which made an unvisited `/sources` show an arbitrary
    // source and left the sidebar highlighting something the user never picked.
    return (
      <SidebarItemList
        heading="Data Sources"
        items={sources.items}
        initialLoad={
          (sources.status === "idle" || sources.status === "loading") && sources.items.length === 0
        }
        error={sources.error}
        toHref={(item) => `/sources/${item.id}`}
        activeId={routeId ?? null}
        emptyText="Connect a data source"
        emptyIcon={<Database />}
        emptyDescription="Pull in data from PostgreSQL, MySQL, CSV, or static input."
        onAdd={() => dispatch(setAddSourceModalOpen(true))}
        addLabel="Add source"
        deleteWarning={(item) => {
          const dependents = pipelines.items.filter((p) => p.sourceDataSourceId === item.id).length;
          if (dependents === 0) return null;
          return `${dependents} pipeline${dependents === 1 ? "" : "s"} read${dependents === 1 ? "s" : ""} from this source and will stop working.`;
        }}
        onDelete={async (item) => {
          await dispatch(deleteSource(item.id));
          if (routeId === item.id) navigate("/sources");
        }}
      />
    );
  }

  if (section === "pipelines") {
    return (
      <SidebarItemList
        heading="Data Pipelines"
        items={pipelines.items}
        initialLoad={
          (pipelines.status === "idle" || pipelines.status === "loading") &&
          pipelines.items.length === 0
        }
        error={pipelines.error}
        toHref={(item) => `/pipelines/${item.id}`}
        activeId={routeId ?? null}
        emptyText="Build your first pipeline"
        emptyIcon={<GitBranch />}
        emptyDescription="Pipelines transform raw source data into typed rows you can chart."
        onAdd={() => dispatch(setCreatePipelineModalOpen(true))}
        addLabel="New pipeline"
        // F-144: deleting a pipeline silently orphaned anything bound to its
        // Outputs, with no warning, unlike the sources section just above.
        // HEL-909: the DataType-named warning is retired along with the
        // DataType feature — an Output-aware warning (naming which Outputs/
        // panels break) is a follow-up, not reintroduced here.
        deleteWarning={(item) => {
          const pipeline = pipelines.items.find((p) => p.id === item.id);
          if (!pipeline) return null;
          return "Any panels bound to this pipeline's Outputs will stop working.";
        }}
        onDelete={async (item) => {
          await dispatch(deletePipeline(item.id));
          if (routeId === item.id) navigate("/pipelines");
        }}
      />
    );
  }

  if (section === "chat" && isFreeTier) {
    // HEL-703 design.md D9 (cycle-2 evaluator CR1) — a `free`-tier user never sees the sidebar's
    // conversation list at all (its fetch is gated above, so `conversations.status` would
    // otherwise sit at "idle" with an empty list forever, falling through to `SidebarItemList`'s
    // own generic "No conversations yet" + "+ New chat" empty state — misleading, since starting a
    // conversation is not actually possible). No heading/filter/"+" — none of that list chrome
    // applies to a section the user cannot use.
    //
    // F-056 — this used to reuse `<EmptyState variant="sidebar">`, the same icon+title+description
    // card shape `ActiveConversationPanel`'s main-content locked state renders (just scaled down),
    // which read as an accidental duplicate stacked directly below it in one viewport. A compact,
    // single-purpose notice (small icon+heading row, one description line, a text-style link) is
    // deliberately a different shape from the main pane's full hero card, not just a smaller
    // version of it — while still sharing `TierRequestAccessCopy` so the two surfaces' wording
    // never drifts apart.
    //
    // F-017: `TierRequestAccessCopy`'s "Contact the workspace owner" text used to be the entire
    // message, even though a self-serve "Request Beta access" flow already exists in Settings
    // (`BetaAccessSection`) — this was actively steering free users away from the one path that
    // works. The link below reaches that flow directly.
    return (
      <section className="sidebar-body__locked-notice" aria-label="assistant">
        <p className="sidebar-body__locked-notice-heading">
          <FontAwesomeIcon icon={faLock} aria-hidden className="sidebar-body__locked-notice-icon" />
          {TierRequestAccessCopy.title}
        </p>
        <p className="sidebar-body__locked-notice-description">
          {TierRequestAccessCopy.description}
        </p>
        <button
          type="button"
          className="sidebar-body__locked-notice-link"
          onClick={() => navigate("/settings")}
        >
          Request access in Settings
        </button>
      </section>
    );
  }

  if (section === "chat") {
    // Server-ordered (`pinned DESC, updatedAt DESC`, HEL-663) — rendered
    // exactly as returned, no client-side re-sort (design.md D3).
    const conversationItems: SidebarItem[] = conversations.items.map((conversation) => ({
      id: conversation.id,
      name: conversation.title,
    }));
    const pinnedIds = new Set(
      conversations.items.filter((conversation) => conversation.pinned).map((c) => c.id),
    );
    const effectiveConversationId =
      conversations.selectedConversationId ?? conversations.items[0]?.id ?? null;
    return (
      <SidebarItemList
        // F-009/F-085: "Chat" vs "Assistant" naming drift — the interaction
        // surfaces (QuickLauncherOverlay, the command-bar trigger, the
        // message-turn role label) already say "Assistant"; this heading and
        // the nav-destination label (navDestinations.ts) are updated to
        // match. The route path (/chat) is unaffected.
        heading="Assistant"
        items={conversationItems}
        initialLoad={
          (conversations.status === "idle" || conversations.status === "loading") &&
          conversationItems.length === 0
        }
        error={conversations.error}
        onSelect={(item) => dispatch(setSelectedConversationId(item.id))}
        activeId={effectiveConversationId}
        emptyText="No conversations yet"
        emptyIcon={faComments}
        emptyDescription="Start a conversation to see it here."
        onAdd={() => dispatch(startNewConversation())}
        addLabel="New chat"
        // No `onDelete` — HEL-663's API has no delete endpoint (design.md D3).
        renderBadge={(item) =>
          pinnedIds.has(item.id) ? (
            <Pin
              className="dashboard-list__pin-badge"
              size={12}
              aria-label="Pinned"
              data-testid="pin-badge"
            />
          ) : null
        }
        renderRowAction={(item, helpers) => {
          const pinned = pinnedIds.has(item.id);
          return (
            <>
              <button
                type="button"
                className="dashboard-list__row-action-btn"
                aria-label={`Rename ${item.name}`}
                title={`Rename ${item.name}`}
                onClick={helpers.startRename}
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="dashboard-list__row-action-btn"
                aria-label={pinned ? `Unpin ${item.name}` : `Pin ${item.name}`}
                title={pinned ? `Unpin ${item.name}` : `Pin ${item.name}`}
                onClick={() => dispatch(togglePinned({ id: item.id, pinned: !pinned }))}
              >
                {pinned ? (
                  <PinOff size={14} aria-hidden="true" />
                ) : (
                  <Pin size={14} aria-hidden="true" />
                )}
              </button>
            </>
          );
        }}
        // HEL-693 design.md D5 — `unwrap()` re-throws the thunk's `rejectValue` (a
        // human-readable message from `extractErrorMessage`) so SidebarItemList's
        // `onRename` reject path shows it inline.
        onRename={async (item, title) => {
          await dispatch(renameConversation({ id: item.id, title })).unwrap();
        }}
      />
    );
  }

  if (section === "other") {
    // F-016: Settings and the proposal/patch-set review routes aren't a list
    // section — they used to fall through to the `DashboardList` default
    // below, which showed a "DASHBOARDS" sidebar with no active nav item and
    // let picking a dashboard silently do nothing (still on the same route).
    // Rendering nothing here is the correct "no section" state; the desktop
    // top nav above already correctly shows no active destination for these
    // routes.
    return null;
  }

  return <DashboardList />;
}
