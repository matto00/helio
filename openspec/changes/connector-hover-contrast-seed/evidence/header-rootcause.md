# Credential / Dependents sort headers at 390 (HEL-1805, owner ruling C2): probe artifact, not a defect

Probe (guard sequence Name, Kind, Base URL, Credential, Dependents, Updated; forced hover + settleTransitions), run before the probe fix:

    Name       rest border rgb(100,94,86) -> hover rgb(157,59,8) hover=true   scrollLeft 0
    Base URL   -> rgb(157,59,8) hover=true                                    scrollLeft 165
    Credential -> rgb(100,94,86) hover=FALSE  (no change, still false 500 ms later)  scrollLeft 267
    Dependents -> rgb(100,94,86) hover=FALSE                                  scrollLeft 369
    Updated    -> rgb(157,59,8) hover=true                                    scrollLeft 486
    geometry after the forced hover: Credential and Dependents button x=276..354, region 24..366,
    elementFromPoint(centre) = "eyebrow connectors-page__th connectors-page__th--actions"  (the sticky Actions header)

With a plain scrollIntoViewIfNeeded first, the same buttons hit-test as themselves and hover to rgb(157,59,8). So the hover rule works; a forced hover (no hit-target check) parks the button under the sticky Actions column and the pointer lands on that. Fix: probeView centres the candidate horizontally (`scrollIntoView({inline:"center"})`) before hovering. After it: Credential/Dependents pass (probefix-390.txt: no sortable-th failure at 390).
