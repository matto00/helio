## Tasks — HEL-269 uploads-root-resolution

- [x] 1. Rewrite `LocalFileSystem.fromEnv` to read `HELIO_UPLOADS_ROOT` first, then `HELIO_UPLOADS_DIR` (backward-compat alias), then default to `~/.helio/uploads`; normalise, validate (absolute + writable), create dirs, warn on legacy cwd-relative path
- [x] 2. Add `fromEnv` unit tests: env var set (absolute), env var set (relative → resolved absolute), neither set (defaults to `~/.helio/uploads`), non-existent dir (created), backward-compat `HELIO_UPLOADS_DIR` alias
- [x] 3. Update `CLAUDE.md` env-var table to document `HELIO_UPLOADS_ROOT`
- [x] 4. Write OpenSpec executor report
