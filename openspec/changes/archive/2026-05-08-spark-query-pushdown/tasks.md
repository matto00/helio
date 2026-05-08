## 1. Backend

- [x] 1.1 In `PanelQueryExecutor.execute()`, apply `df.filter(expr)` for each `JsString` item in `query.filters` after projection
- [x] 1.2 In `PanelQueryExecutor.execute()`, apply `df.orderBy(expr)` when `query.sort` is `Some(expr)`
- [x] 1.3 In `PanelQueryExecutor.execute()`, apply `df.limit(n)` when `query.limit` is `Some(n)`
- [x] 1.4 Ensure pushdown order is: select → filter → sort → limit

## 2. Tests

- [x] 2.1 Add test: `filters` pushdown — single filter expression reduces result rows
- [x] 2.2 Add test: `sort` pushdown — sort expression orders result rows ascending/descending
- [x] 2.3 Add test: `limit` pushdown — limit restricts collected row count
- [x] 2.4 Add test: combined projection + filter + sort + limit returns correct subset in correct order
