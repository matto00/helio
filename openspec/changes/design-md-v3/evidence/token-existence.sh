#!/usr/bin/env bash
# task 2.6 / C4: every --token named in DESIGN.md is declared in theme.css,
# or is a documented runtime-set / component-scoped token, or a BEM class modifier.
cd "$(git rev-parse --show-toplevel)"
CSS=frontend/src/theme/theme.css
RUNTIME="--app-focus-ring-color --app-accent-text --app-selection-bg --panel-surface-override --toast-exit-duration"
BEM="--active --dragging --focused --left --right --selected"   # class modifiers (e.g. .panel-card--dragging), not custom properties
PREFIX="--app --space --text"   # family globs written as --app-* / --space-* / --text-*
NOTADOPTED="--app-state-hover --app-state-selected"   # Appendix A.2 (HEL-866): proposed, explicitly "not adopted", so intentionally undeclared
fail=0
# a token is --name preceded by a non-[a-z0-9-] char, not ending in '-' (excludes prefixes like --space- and table rules ---)
for tok in $(grep -oE -- '(^|[^a-z0-9-])--[a-z][a-z0-9-]*[a-z0-9]' DESIGN.md | sed -E 's/^[^-]*//' | sort -u); do
  if grep -qE "^\s*${tok}:" "$CSS"; then echo "OK             $tok (declared in theme.css)"
  elif [[ " $RUNTIME " == *" $tok "* ]]; then
    where=$(grep -rlE -e "${tok}" frontend/src --include='*.ts' --include='*.tsx' --include='*.css' | grep -v test | head -2 | tr '\n' ' ')
    echo "OK-DOCUMENTED  $tok (runtime-set / component-scoped; used in: $where)"
  elif [[ " $PREFIX " == *" $tok "* ]]; then echo "OK-FAMILY      $tok-* (family glob, not a token)"
  elif [[ " $NOTADOPTED " == *" $tok "* ]]; then echo "OK-NOT-ADOPTED $tok (named only as a rejected proposal, Appendix A.2)"
  elif [[ " $BEM " == *" $tok "* ]]; then echo "OK-BEM         $tok (class modifier, not a custom property)"
  else echo "MISSING        $tok"; fail=1; fi
done
echo "exit=$fail"; exit $fail
