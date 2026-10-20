# HEL-1676: Draft preview: a catastrophic-backtracking user regex (stringops extractRegex, assert regex) holds both instance slots; time-box or guard regex evaluation

## Description

origin_kind: followup
origin_ticket: HEL-1630 (PR matto00/helio#1069, merged as 069afd36d)

Since HEL-1630, a draft-preview walk holds its instance slot until the walk ends; there are 2 slots per instance. A user regex with catastrophic backtracking in `stringops extractRegex` or `assert regex` can run for a long time inside one node. Measured: `^(.*a){12}$` went from 25 to 124 ms as the input grew from 18 to 24 characters, which is exponential. Two such requests take draft preview down on an instance until they finish. The same regex in a real run (HEL-1660's path) ties up a run.

## Fix options

* Evaluate user regexes with a time box, e.g. a CharSequence wrapper that checks a deadline in `charAt`.
* Use a linear-time engine (RE2/J).
* Reject known-catastrophic patterns at config validation.

Apply the same choice to draft preview and to runs.

## Acceptance criteria

* A backtracking pattern on a long input ends within a bounded time with a step error naming the step.
* Both draft-preview slots are free afterwards.
* A test fails first; normal regexes behave identically.
