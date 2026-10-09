#!/usr/bin/env bash
# usage: dump.sh <outdir>
C=/home/matt/Development/helio/.claude/worktrees/task/split-expression-evaluator/HEL-1404/backend/target/out/jvm/scala-2.13.15/helio-backend/classes
O=$1; mkdir -p $O; rm -f $O/*
P=com.helio.domain.engine
for c in 'ExpressionEvaluator' 'ExpressionEvaluator$' 'ExpressionEvaluator$CompiledExpression' 'EvaluationError' 'EvaluationError$' 'EvaluationError$DivisionByZero' 'EvaluationError$DivisionByZero$' 'EvaluationError$UnknownField' 'EvaluationError$UnknownField$' 'EvaluationError$ParseError' 'EvaluationError$ParseError$' 'EvaluationError$TypeError' 'EvaluationError$TypeError$'; do
  javap -public -cp $C "$P.$c" > "$O/$c.txt" 2>&1
done
ls $C/com/helio/domain/engine/ | grep '^ExpressionEvaluator\$' | sort > $O/_classfiles.txt
ls $C/com/helio/domain/engine/ | grep -E '^Expression(Tokenizer|Parser|TypeInference|Interpreter)' | sort >> $O/_classfiles.txt
