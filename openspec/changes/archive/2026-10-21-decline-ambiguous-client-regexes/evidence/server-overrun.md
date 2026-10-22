# Task 1.3 server overrun measurement (Scala engine, HEL-1676 time box)

Dev backend on :10022 (this worktree). Throwaway user, one static source with ONE row `text = "a"x28 + "!"`,
pipeline with one `stringops` step `{operation: extractRegex, field: text, outputColumn: out, pattern: ^(a*a*a*a*a*a*a*a*a*a*)$}`.
`POST /api/pipelines/:id/run` (the same engine and time box the draft preview uses):

    http 422 time 2.076765s
    {"message":"Pipeline execution failed at step <id> (stringops) [path: ...]: stringops operation 'extractRegex' pattern '^(a*a*a*a*a*a*a*a*a*a*)$' exceeded the 2 s regex time budget for this step"}

So a client-declined pattern (declined by this change) over one cell within the draft caps exceeds the 2 s budget in the
Scala engine, and the step error reads "... exceeded the 2 s regex time budget for this step". The e2e overrun edit uses
this pattern and asserts that text on the draft step. (Test user/source/pipeline deleted by exact id afterwards.)
