## 1. Frontend — CSS

- [x] 1.1 Add label container query overrides to `PanelContent.css`: compact `0.65rem` at `max-height: 179px`, spacious `0.85rem` at `min-height: 280px`
- [x] 1.2 Add base trend indicator styles to `PanelContent.css`: `.panel-content__metric-trend` at `0.7rem`, muted color, letter-spacing
- [x] 1.3 Add trend indicator directional modifier classes: `--up` (accent/green), `--down` (danger/red), `--flat` (muted)
- [x] 1.4 Add trend indicator container query overrides: compact `0.6rem`, spacious `0.8rem`

## 2. Frontend — Component

- [x] 2.1 Update `MetricContent` in `PanelContent.tsx` to render `.panel-content__metric-trend` when `data.trend` is present
- [x] 2.2 Derive trend direction class (`--up`, `--down`, `--flat`) from leading character of `data.trend` string

## 3. Tests

- [x] 3.1 Add test to `PanelContent.test.tsx`: trend indicator renders with `--up` class when trend starts with `+`
- [x] 3.2 Add test: trend indicator renders with `--down` class when trend starts with `-`
- [x] 3.3 Add test: trend indicator renders with `--flat` class for neutral trend string
- [x] 3.4 Add test: trend indicator is absent when `data.trend` is not present
- [x] 3.5 Add test: unbound metric panel (no data) does not render trend indicator
