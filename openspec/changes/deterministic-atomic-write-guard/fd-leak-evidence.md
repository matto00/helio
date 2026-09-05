# HEL-984 — root-cause evidence: file-descriptor leak, not a scheduling race

## CI ground truth (run 33948170131, attempt 1, job 101257904894)

    - should stages a same-directory temp file during a large write ... *** FAILED ***
      java.nio.file.FileSystemException: /tmp/helio-fs-test.../atomic-probe: Too many open files
        at java.nio.file.Files.list(Files.java:3785)
        at ...LocalFileSystemSpec.tempSiblings$1(LocalFileSystemSpec.scala:120)

    - should cleans up the temp file and leaves the original untouched ... *** FAILED ***
      java.nio.file.FileSystemException: /tmp/helio-fs-test.../atomic-fail/blocked.bin/inner.txt: Too many open files
        at java.nio.file.Files.write(Files.java:3505)
        at ...LocalFileSystemSpec.$anonfun$new$18(LocalFileSystemSpec.scala:149)

    com.helio.infrastructure.storage.LocalFileSystemSpec *** ABORTED ***
      java.lang.NoClassDefFoundError: com/helio/infrastructure/storage/LocalFileSystem$

    Tests: succeeded 3781, failed 2

Line 120 is inside the poller's `tempSiblings()`. Line 149 is the SECOND test's fixture
setup (`Files.write(target.resolve("inner.txt"), ...)`) — it never reached an assertion.

## Mechanical proof of the leak (JDK, this machine)

`Files.list` returns a `Stream` backed by an open `DirectoryStream`; the spec calls
`.iterator()` on it and never closes it.

    baseline fds=8
    after 20000 unclosed Files.list: fds=40010
    after 20000 CLOSED Files.list:   fds=40012

20,000 unclosed calls leak 40,002 descriptors (2 per call) and they are never reclaimed;
the identical loop with the stream closed in try-with-resources leaks none. The poller
executes this pattern in a tight loop with no sleep for the duration of a 64 MiB write.

## Conclusion

- The ticket's hypothesised mechanism (poller not scheduled inside the window / write too
  fast) is plausible but is NOT what happened.
- The two tests are related by shared-process descriptor exhaustion, not by a shared racy
  fixture. Test 2 has no timing window of its own.
- Deleting the poller removes the real root cause as well as the assumed one.
- It never reproduces on the dev box because `ulimit -n` here is 524288.
