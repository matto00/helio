import com.helio.domain.engine.ExpressionEvaluator$;
import scala.collection.immutable.Map$;
public class Probe {
  public static void main(String[] a) {
    Object row = Map$.MODULE$.empty();
    String[] exprs = {"1 / 0", "$a / 0", "1 + )", "x + $y", "x + foo(1)", "x + ,"};
    for (String e : exprs) {
      System.out.println(e + " => " + ExpressionEvaluator$.MODULE$.evaluate(e, (scala.collection.immutable.Map) row));
      System.out.println(e + " => parseProblem " + ExpressionEvaluator$.MODULE$.parseProblem(e));
    }
  }
}
