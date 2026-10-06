# Evidence ids (HEL-1342)

Shared dev DB, own servers dev 6774 / backend 9681. Server PIDs: frontend node 2779151, backend java 2778464 (cwd verified = this worktree).
Deletion is by these exact ids only.

- user: `bad6ca04-84a0-4896-825a-3e0a50e51cee` (hel1342-measure-1791289494915@example.test), promoted: `UPDATE users SET tier='owner' WHERE id='bad6ca04-84a0-4896-825a-3e0a50e51cee'` -> UPDATE 1
- dashboard: `53252730-9f7b-4346-93ef-6ca77da8daf8`
- data source: `d1165ece-ff85-4507-9257-62ea61622cdf`
- pipeline: `f0c9604d-5b3c-4466-a3ad-f96875ca1ba6`
- output: `0a6fe0d5-9d9e-42a3-b3a0-cdac944253c6`
- panel pie: `792c87a5-e8be-4ef4-b1e1-ec810a12802f`
- panel pie-percent: `2c4306cb-730a-4f16-81bf-9c17e655e5fb`

## Deletion status (task 5.2)

API deletes with the throwaway's own session: panels (2x 204), dashboard 204, output 200, pipeline 204, data source 204; re-queried: none present. Then `DELETE FROM pipeline_run_rate_window WHERE user_id='bad6ca04-84a0-4896-825a-3e0a50e51cee'` -> DELETE 1 (RESTRICT FK, created by the pipeline run), then `DELETE FROM users WHERE id='bad6ca04-84a0-4896-825a-3e0a50e51cee'` -> DELETE 1. Re-query by exact user id: users=0. Residue: none known (no other FK row blocked the user delete).

## Cycle 2 (percent-label re-measurement)

Servers restarted on 6774/9681 (frontend node 3031077, backend java 3030601; cwd verified = this worktree).
- user `60d622b3-f874-4512-ad3f-bd68719f39bf`, promoted `UPDATE users SET tier='owner' WHERE id='60d622b3-f874-4512-ad3f-bd68719f39bf'` -> UPDATE 1
- dashboard `83a1ee1c-5e45-422d-bdd6-fb952903b788`, source `3fb7e103-ce72-4d10-a64f-6c470b05162c`, pipeline `773cbbc3-ecf1-4922-927c-ac5a5ca61fb9`
- outputs `7f1647cd-ca19-4a4a-b7ac-64db94c278f3` (default), `dc954301-74bb-47ef-b33b-c7f865873c8a` (percent)
- panels `a539a287-91d3-4f72-b1c0-da7e6cb7d12e` (Alpha), `be71b82b-02ad-42b3-8c24-3516d96ff74c` (Bravo)
Cleanup: panels 204x2, dashboard 204, outputs 200x2, pipeline 204, source 204 (re-query: none present); `DELETE FROM pipeline_run_rate_window WHERE user_id='60d622b3-f874-4512-ad3f-bd68719f39bf'` -> DELETE 1; `DELETE FROM users WHERE id='60d622b3-f874-4512-ad3f-bd68719f39bf'` -> DELETE 1; re-query users=0. Residue: none. Servers stopped by recorded PID.
