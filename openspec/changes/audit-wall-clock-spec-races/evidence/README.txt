HEL-1341 D7 proof transcripts. Every probe (P) and mutation (M) edit was temporary; after each run
`git checkout -- backend` reverted it (final `git diff HEAD` is clean of probe edits, see end of file).
In each transcript "--- git diff HEAD ---" shows the temporary edit (for OLD runs it includes the
restoration of the pre-change spec from 469f4ea93, shown as the inverse of the fix).
Row 2 and Row 3 M runs are TEST-SIDE substitutes (the specs reach no production code): labelled in-file.
Notes:
 - Rows 4-6 P (vacuity): the one failing test in the OLD run is row 3's positive accept check ("connect when the
   address is allowed", which the slow acceptor correctly breaks); the four negative-accept tests PASS = vacuous.
 - Row 7: the collateral failure of "rolls the whole rotation back..." under the not-awaited mutation is expected
   (the delete runs in a separate session, so it is not rolled back); the target test is "does not return success...".
