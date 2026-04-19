## 1. Backend: Database Migration

- [x] 1.1 Create `V10__owner_id.sql`: insert system user (UUID `00000000-0000-0000-0000-000000000001`) with ON CONFLICT DO NOTHING
- [x] 1.2 Add `owner_id VARCHAR NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES users(id)` to `dashboards`
- [x] 1.3 Add `owner_id VARCHAR NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES users(id)` to `panels`
- [x] 1.4 Backfill any existing NULL `owner_id` rows in both tables to the system user UUID

## 2. Backend: Repository Layer

- [x] 2.1 Add `ownerId: String` field to `DashboardRow` case class and `DashboardTable` mapping
- [x] 2.2 Add `ownerId: String` field to `PanelRow` case class and `PanelTable` mapping
- [x] 2.3 Update `DashboardRepository.findAll()` to accept `ownerId: UserId` and filter by it
- [x] 2.4 Update `DashboardRepository.insert()` to persist `ownerId` from the `Dashboard` domain object
- [x] 2.5 Update `DashboardRepository.duplicate()` to accept and set `ownerId` on the new dashboard and panels
- [x] 2.6 Update `DashboardRepository.importSnapshot()` to accept and set `ownerId` on the new dashboard and panels
- [x] 2.7 Add `ownerId: UserId` to the `Dashboard` domain case class
- [x] 2.8 Add `ownerId: UserId` to the `Panel` domain case class
- [x] 2.9 Update `PanelRepository.insert()` to persist `ownerId`
- [x] 2.10 Update `PanelRepository.findByDashboardId()` — no ownership filter needed (checked at route level)

## 3. Backend: Route Layer Ownership Enforcement

- [x] 3.1 Add helper `def ownershipCheck(resource: Option[{ownerId: UserId}]): Either[...]` or inline guard in `DashboardRoutes`
- [x] 3.2 `GET /api/dashboards` — pass `user.id` to `findAll()`
- [x] 3.3 `GET /api/dashboards/:id/panels` — verify dashboard `ownerId == user.id`, return 403 if not
- [x] 3.4 `PATCH /api/dashboards/:id` — verify ownership before update, return 403 if not
- [x] 3.5 `DELETE /api/dashboards/:id` — verify ownership before delete, return 403 if not
- [x] 3.6 `POST /api/dashboards/:id/duplicate` — verify ownership before duplicate, return 403 if not; pass `user.id` as new owner
- [x] 3.7 `GET /api/dashboards/:id/export` — verify ownership before export, return 403 if not
- [x] 3.8 `POST /api/dashboards/import` — pass `user.id` as owner to `importSnapshot()`
- [x] 3.9 `PATCH /api/panels/:id` — verify `panel.ownerId == user.id`, return 403 if not
- [x] 3.10 `DELETE /api/panels/:id` — verify `panel.ownerId == user.id`, return 403 if not
- [x] 3.11 `POST /api/panels/:id/duplicate` — verify ownership before duplicate, pass `user.id` as new owner
- [x] 3.12 `POST /api/panels` — set `ownerId = user.id` on created panel

## 4. Backend: Demo Data

- [x] 4.1 Update `DemoData.seedIfEmpty` to accept `UserRepository` and look up system user UUID
- [x] 4.2 Set `ownerId = UserId("00000000-0000-0000-0000-000000000001")` on all seeded dashboards and panels

## 5. Tests

- [x] 5.1 Update `ApiRoutesSpec` to insert a test user and pass a valid session token in all dashboard/panel requests
- [x] 5.2 Add test: `GET /api/dashboards` returns only the caller's dashboards (not other users')
- [x] 5.3 Add test: `PATCH /api/dashboards/:id` returns 403 when caller does not own the dashboard
- [x] 5.4 Add test: `DELETE /api/dashboards/:id` returns 403 when caller does not own the dashboard
- [x] 5.5 Add test: `GET /api/dashboards/:id/panels` returns 403 when caller does not own the dashboard
- [x] 5.6 Add test: `PATCH /api/panels/:id` returns 403 when caller does not own the panel
- [x] 5.7 Add test: `DELETE /api/panels/:id` returns 403 when caller does not own the panel
