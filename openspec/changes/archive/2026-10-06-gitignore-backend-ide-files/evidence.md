## RED: git status --porcelain (before .gitignore edit)
?? backend/.jvmopts
?? backend/project/metals.sbt
?? openspec/changes/gitignore-backend-ide-files/

## GREEN: git status --porcelain (planted files present, after edit)
 M .gitignore
?? openspec/changes/gitignore-backend-ide-files/

## check-ignore -v --no-index (must each report a rule)
.gitignore:21:backend/.jvmopts	backend/.jvmopts
exit=0
.gitignore:17:backend/project/metals.sbt	backend/project/metals.sbt
exit=0
.gitignore:14:backend/project/project/	backend/project/project/metals.sbt
exit=0
.gitignore:15:backend/project/.bloop/	backend/project/.bloop/x
exit=0
.gitignore:16:backend/project/.bsp/	backend/project/.bsp/x
exit=0
.gitignore:3:.metals/	backend/project/.metals/x
exit=0
.gitignore:14:backend/project/project/	backend/project/project/x
exit=0
.gitignore:13:backend/project/target/	backend/project/target/x
exit=0

## check-ignore -v index-aware on planted files
.gitignore:21:backend/.jvmopts	backend/.jvmopts
exit=0
.gitignore:17:backend/project/metals.sbt	backend/project/metals.sbt
exit=0

## check-ignore -v --no-index on tracked + hypothetical (must print nothing, exit 1)
[backend/project/TestShards.scala]
exit=1
[backend/project/build.properties]
exit=1
[backend/project/gen-test-suite-weights.py]
exit=1
[backend/project/plugins.sbt]
exit=1
[backend/project/test-suite-weights.tsv]
exit=1
[backend/project/NewBuildSource.scala]
exit=1

## git ls-files backend/project
backend/project/TestShards.scala
backend/project/build.properties
backend/project/gen-test-suite-weights.py
backend/project/plugins.sbt
backend/project/test-suite-weights.tsv
