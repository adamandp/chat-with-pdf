// Put the first method of a chain on its own line, alongside later methods.
export default {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    messages: { newline: 'Start a method chain on a new line.' },
  },
  create(context) {
    const source = context.sourceCode;

    return {
      CallExpression(node) {
        const callee = node.callee;
        const parent = node.parent;

        if (
          callee.type !== 'MemberExpression'
          || callee.computed
          || callee.object.type === 'CallExpression'
          || parent.type !== 'MemberExpression'
          || parent.object !== node
          || parent.parent.type !== 'CallExpression'
          || parent.parent.callee !== parent
        ) return;

        const dot = source.getTokenAfter(callee.object, { filter: (token) => token.value === '.' || token.value === '?.' });

        if (!dot || callee.object.loc.end.line !== dot.loc.start.line) return;

        context.report({
          node: callee.property,
          messageId: 'newline',
          fix: (fixer) => fixer.insertTextBefore(dot, '\n'),
        });
      },
    };
  },
};
