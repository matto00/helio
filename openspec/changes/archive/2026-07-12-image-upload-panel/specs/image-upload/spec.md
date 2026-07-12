## ADDED Requirements

### Requirement: Authenticated multipart image upload
`POST /api/uploads/image` SHALL require authentication, accept a `multipart/form-data` body with a
`file` part, validate the part's filename extension against `{png, jpg, jpeg, gif, webp}`, persist
the bytes via the `FileSystem` abstraction at `images/<uuid>.<ext>`, record a metadata row (owner,
storage key, MIME type, filename, size in bytes), and respond `201 Created` with `{ id, url }`
where `url` is `/api/uploads/image/<id>`.

#### Scenario: Successful upload returns id and url
- **WHEN** an authenticated user POSTs a valid PNG file to `/api/uploads/image`
- **THEN** the response is `201 Created` with a JSON body containing a non-empty `id` and a `url`
  of the form `/api/uploads/image/<id>`

#### Scenario: Unauthenticated upload is rejected
- **WHEN** a request to `POST /api/uploads/image` is made without a valid Bearer token
- **THEN** the response is `401 Unauthorized` and no file is persisted

### Requirement: Non-image MIME types are rejected at the route level
`POST /api/uploads/image` SHALL reject any file part whose filename extension is not in
`{png, jpg, jpeg, gif, webp}` with `400 Bad Request`, before any bytes are written via `FileSystem`.

#### Scenario: Unsupported extension is rejected
- **WHEN** a file named `document.pdf` is POSTed to `/api/uploads/image`
- **THEN** the response is `400 Bad Request` and no file is written to storage

#### Scenario: Missing file part is rejected
- **WHEN** a multipart request to `/api/uploads/image` has no `file` part
- **THEN** the response is `400 Bad Request`

### Requirement: Upload size limit enforced
`POST /api/uploads/image` SHALL reject files exceeding `IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES`
(default `10485760`, i.e. 10 MB) with `413 Request Entity Too Large`, both at the route layer
(fast rejection) and as the authoritative check at the service layer.

#### Scenario: Oversized file is rejected
- **WHEN** a file larger than the configured maximum is POSTed to `/api/uploads/image`
- **THEN** the response is `413 Request Entity Too Large` and no file is written to storage

#### Scenario: File at the limit is accepted
- **WHEN** a valid image file at exactly the configured maximum size is POSTed
- **THEN** the response is `201 Created`

### Requirement: Byte-serving endpoint is unauthenticated
`GET /api/uploads/image/:id` SHALL serve the stored bytes for `id` with the recorded `Content-Type`
header, without requiring authentication, so a plain `<img src>` element can load it directly.
Unknown `id`s SHALL respond `404 Not Found`.

#### Scenario: Serving a valid upload
- **WHEN** `GET /api/uploads/image/<id>` is requested for a previously uploaded image, with no
  `Authorization` header
- **THEN** the response is `200 OK` with the original bytes and the recorded MIME type as
  `Content-Type`

#### Scenario: Serving an unknown id
- **WHEN** `GET /api/uploads/image/<id>` is requested for an id that was never uploaded
- **THEN** the response is `404 Not Found`

### Requirement: Uploaded-image metadata is owner-scoped at the storage layer
The `image_uploads` table SHALL have Row Level Security enabled with an owner policy restricting
default (`withUserContext`) access to rows where `owner_id` matches the current user. Writes from
`POST /api/uploads/image` SHALL run in the uploading user's context. Reads for the serving endpoint
SHALL use the privileged (`withSystemContext`) pool, intentionally bypassing the owner policy so
the endpoint remains servable without authentication.

#### Scenario: RLS is enabled on image_uploads
- **WHEN** the Flyway migration creating `image_uploads` is applied
- **THEN** `SELECT relrowsecurity FROM pg_class WHERE relname = 'image_uploads'` returns true

#### Scenario: Insert runs in the uploading user's context
- **WHEN** `POST /api/uploads/image` is handled for user A
- **THEN** the metadata row is inserted via `withUserContext(userA.id)`
