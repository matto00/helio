# Move evidence (D6a)

Base: b409172a model.scala (`git show b409172a:backend/src/main/scala/com/helio/domain/model/model.scala`). Checker: `move-check/move-check.py` (forward text equality per span, positional reverse over non-blank lines of all three files, coverage of every non-blank base line exactly once). Blank lines exempt per D6a.

## Green run
```
OK ChartAppearance.scala: 160 non-blank lines match positionally
OK PanelAppearance.scala: 92 non-blank lines match positionally
OK model.scala: 937 non-blank lines match positionally
coverage: 1184 non-blank base lines; moved chart=157 panel=88 imports=2 kept=937
PASS
```

## Red 1: one token changed inside a moved body (scratch copy)
```
FAIL
  ChartAppearance.scala: nonblank line 28 differs
   file:     '    legend  = ChartLegend(show = true, position = "topp"),'
   expected: '    legend  = ChartLegend(show = true, position = "top"),'
```

## Red 2: duplicated existing `}` line inserted between spans (scratch copy)
```
FAIL
  ChartAppearance.scala: nonblank line 161 differs
   file:     '}'
   expected: '<extra in file>'
```

## git diff --numstat (--color-moved=plain; new files intent-to-add)
```
172	0	backend/src/main/scala/com/helio/domain/model/ChartAppearance.scala
101	0	backend/src/main/scala/com/helio/domain/model/PanelAppearance.scala
5	3	backend/src/main/scala/com/helio/domain/model/README.md
0	265	backend/src/main/scala/com/helio/domain/model/model.scala
```
model.scala: 1306 -> 1041 lines; ChartAppearance.scala 172; PanelAppearance.scala 101. Pure deletion from model.scala (0 added / 265 removed).
