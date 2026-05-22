# Design — Uploads Root Resolution (HEL-269)

## Resolution algorithm (in `LocalFileSystem.fromEnv`)

```
1. Try HELIO_UPLOADS_ROOT  →  use verbatim (toAbsolutePath.normalize)
2. Try HELIO_UPLOADS_DIR   →  backward-compat alias; use verbatim
3. Default                 →  ${user.home}/.helio/uploads
```

After resolving the path:
- Call `toAbsolutePath.normalize` regardless of source.
- `assert(resolved.isAbsolute)` — should always hold after `toAbsolutePath`.
- Attempt `Files.createDirectories(resolved)`.
- Attempt a probe write: `Files.isWritable(resolved)` — fail loud if false.

## Legacy detection (default path only)

If step 3 (default) is taken:
- Construct the legacy path: `Paths.get(System.getProperty("user.dir"), "data", "uploads")`.
- If it exists and contains at least one regular file, emit a single `WARN` (to the standard logger):
  ```
  [WARN] Legacy uploads detected at <legacy-path>.
         Set HELIO_UPLOADS_ROOT=<legacy-path> to keep using it, or move files to ~/.helio/uploads.
         Files will NOT be moved automatically.
  ```

## Startup validation

Fatal conditions (throw `IllegalStateException` to abort startup):
- Resolved path is not absolute (should never happen after `toAbsolutePath`, defensive check).
- `Files.createDirectories` fails with an `IOException`.
- Resolved path exists but `Files.isWritable` returns false.

## Env vars

| Variable            | Behaviour                                                    |
|---------------------|--------------------------------------------------------------|
| `HELIO_UPLOADS_ROOT`| Primary. Checked first. Any path (absolute or relative).     |
| `HELIO_UPLOADS_DIR` | Legacy alias. Checked if `HELIO_UPLOADS_ROOT` is absent.     |
| _(neither set)_     | Defaults to `${user.home}/.helio/uploads`.                   |

## Tests

- `fromEnv` with `HELIO_UPLOADS_ROOT` set to an absolute temp path → uses that path exactly.
- `fromEnv` with `HELIO_UPLOADS_ROOT` set to a relative path → resolves to absolute.
- `fromEnv` with neither var set → base dir equals `${user.home}/.helio/uploads` (normalised).
- `fromEnv` with a non-existent path → creates directory tree without error.
- `fromEnv` with `HELIO_UPLOADS_DIR` set (and `HELIO_UPLOADS_ROOT` absent) → backward-compat alias honoured.
