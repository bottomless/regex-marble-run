# Decisions

Choices made where the brief was ambiguous or where reality disagreed with the plan.

## Engine

- **V8 bug excluded from differential tests.** Under the `v` flag, V8 (14.6, Node 26) lets a character
  class that follows a modifier group inherit the group's flags: `/(?i:a)[b]/v.exec('aB')` matches although
  `/(?i:a)b/v` does not and `/(?i:a)[b]/u` does not. Our engine follows the spec. The fuzzer skips
  `v` + modifiers so the "zero mismatches" bar measures our bugs, not theirs.
- **What's a step.** One step is one gate/sensor/mirror/lookbehind test or one backtrack (a flag popped).
  Lookahead completion itself is not a step; its inner tests already are. Diverter choices are free.
- **Backreference to an in-progress group** is treated as unset (matches empty), which is what the spec
  does because a group's capture is only updated when the group closes.
