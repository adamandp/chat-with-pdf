export default {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    messages: { padding: 'Remove empty lines at the edges of this object or array.' },
  },
  create(context) {
    const source = context.sourceCode;

    function check(node) {
      const tokens = source.getTokens(node);

      if (tokens.length < 2) return;

      const pairs = [
        [tokens[0], tokens[1]],
        [tokens[tokens.length - 2], tokens[tokens.length - 1]],
      ];

      for (const [left, right] of pairs) {
        const gap = source.text.slice(left.range[1], right.range[0]);

        if (!/^\s+$/.test(gap) || (gap.match(/\n/g) || []).length < 2) continue;

        context.report({
          node,
          messageId: 'padding',
          fix: (fixer) => fixer.replaceTextRange(
            [left.range[1], right.range[0]],
            '\n' + gap.slice(gap.lastIndexOf('\n') + 1),
          ),
        });
      }
    }

    return { ObjectExpression: check, ArrayExpression: check, ObjectPattern: check, ArrayPattern: check };
  },
};
