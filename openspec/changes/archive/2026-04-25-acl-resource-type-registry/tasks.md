## 1. Backend — Core Registry

- [x] 1.1 Create `ResourceType.scala` in `com.helio.api` with case class `ResourceType(key: String, ownerResolver: String => Future[Option[String]])`
- [x] 1.2 Create `ResourceTypeRegistry.scala` in `com.helio.api` with constructor validation (throws `IllegalArgumentException` on duplicate keys) and `lookup(key: String): Option[ResourceType]`

## 2. Backend — AclDirective Integration

- [x] 2.1 Modify `AclDirective` constructor to accept `ResourceTypeRegistry` in addition to `ResourcePermissionRepository`
- [x] 2.2 Update `authorizeResource` signature: replace `resolver: String => Future[Option[String]]` parameter with `resourceType: String`; look up resolver from registry; return 500 on unknown key
- [x] 2.3 Update `authorizeResourceWithSharing` signature: remove the `resolver` parameter; look up resolver from registry by `resourceType`; return 500 on unknown key

## 3. Backend — Route Wiring

- [x] 3.1 Build a `ResourceTypeRegistry` in `ApiRoutes` with entries for `"dashboard"`, `"panel"`, `"data-source"`, and `"data-type"` using their respective repository resolvers
- [x] 3.2 Inject the registry into `AclDirective` in `ApiRoutes`
- [x] 3.3 Update `DataTypeRoutes`: remove `dataTypeResolver` lambda; pass `"data-type"` key string to `acl.authorizeResource`
- [x] 3.4 Update `DataSourceRoutes`: remove `dataSourceResolver` lambda; pass `"data-source"` key string to `acl.authorizeResource`
- [x] 3.5 Update `PanelRoutes`: remove panel resolver lambda; pass `"panel"` key string to `acl.authorizeResource` and `acl.authorizeResourceWithSharing`
- [x] 3.6 Update `DashboardRoutes` / `PermissionRoutes` / `PublicDashboardRoutes`: replace inline resolver args with `"dashboard"` key string

## 4. Tests

- [x] 4.1 Update `AclDirectiveSpec`: construct a `ResourceTypeRegistry` stub with the test resolver; update all `authorizeResource` and `authorizeResourceWithSharing` calls to pass the resource type key instead of a lambda
- [x] 4.2 Add test: registry with duplicate keys throws `IllegalArgumentException` at construction
- [x] 4.3 Add test: `authorizeResource` with an unknown key returns 500 Internal Server Error
- [x] 4.4 Run `sbt test` and confirm all existing ACL scenarios pass
