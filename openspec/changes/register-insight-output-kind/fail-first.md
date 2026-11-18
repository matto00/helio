# Fail-first (task 0.1)

Test: OutputRoutesSpec "let the owner create a minimal insight Output and store its config as {} (HEL-1740)"
(POST /pipelines/:id/outputs, kind insight, config {}), run BEFORE any production change.

Command: cd backend && nice -n 19 sbt -J-Xmx3g "testOnly com.helio.api.routes.pipelines.OutputRoutesSpec -- -z HEL-1740"

Output:
[info] - should let the owner create a minimal insight Output and store its config as {} (HEL-1740) *** FAILED ***
[info]   400 Bad Request was not equal to 201 Created (OutputRoutesSpec.scala:230)
[info] *** 1 TEST FAILED ***
3.9: no dev-DB rows were created (backend never booted).
