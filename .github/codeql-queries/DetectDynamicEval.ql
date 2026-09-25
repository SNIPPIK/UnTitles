/**
 * @name Dynamic eval execution
 * @description Finds calls to eval() where the argument is a dynamically constructed string.
 * @kind problem
 * @problem.severity error
 * @id js/dynamic-eval
 * @tags security
 *       external/cwe/cwe-95
 */

import javascript

from CallExpr call, Expr arg
where
  call.getCalleeName() = "eval" and
  arg = call.getArgument(0) and
  // Проверяем, что аргумент не является простым строковым литералом
  not arg instanceof StringLiteral
select call, "Dynamic string passed to eval(). This may lead to code injection."