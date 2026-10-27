export default {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    messages: { spacing: 'Separate await statements with a blank line.' },
  },
  create(context) {
    const source = context.sourceCode;
    const isAwait = (node) => node.type === 'ExpressionStatement' && node.expression.type === 'AwaitExpression';

    function check(statements) {
      for (let index = 1; index < statements.length; index++) {
        const previous = statements[index - 1];
        const current = statements[index];

        if (!isAwait(previous) && !isAwait(current)) continue;

        const gap = source.text.slice(previous.range[1], current.range[0]);

        if (/\r?\n[\t ]*\r?\n/.test(gap)) continue;

        context.report({
          node: current,
          messageId: 'spacing',
          fix: (fixer) => fixer.insertTextAfter(previous, gap.includes('\n') ? '\n' : '\n\n'),
        });
      }
    }

    return {
      Program: (node) => check(node.body),
      BlockStatement: (node) => check(node.body),
      SwitchCase: (node) => check(node.consequent),
    };
  },
};
