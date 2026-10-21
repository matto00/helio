# Task 3.3 green e2e (with the allowlist change)

Same spec, same command as red-probe.md; result: **1 passed (12.0s)**.

[HEL-1683 e2e] control longest long task: 0.0 ms (tasks: )
[HEL-1683 e2e] probe longest long task: 0.0 ms (tasks: ); requests: POST /api/pipelines/f3b1a9dc-de10-4591-8400-6d867e11a813/draft-preview
[HEL-1683 e2e] overrun longest long task: 0.0 ms

- Control `(\d+)`: client rows ("5 rows"), no draft-preview request, longest task 0.0 ms.
- Probe `^(.*.*.*.*.*.*.*.*x)`: longest task 0.0 ms (was 825.0 ms red); the step went to `POST /api/pipelines/<id>/draft-preview`
  and the draft shows "Preview is live" with "5 rows" (the server result).
- Overrun `^(a*a*a*a*a*a*a*a*a*a*)$`: the draft step shows the server's "... exceeded the 2 s regex time budget for this step" error;
  longest main-thread task 0.0 ms.
