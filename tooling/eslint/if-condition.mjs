export default {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    messages: { newline: 'Wrap long if conditions across multiple lines.' },
  },
  create(context) {
    const source = context.sourceCode;

    return {
      IfStatement(node) {
        const open = source.getTokenAfter(source.getFirstToken(node));
        const close = source.getTokenBefore(node.consequent);

        if (open.loc.start.line !== close.loc.end.line || close.loc.end.column <= 80) return;

        const pairs = [
          [open, source.getTokenAfter(open)],
          [source.getTokenBefore(close), close],
        ];

        for (const token of source.getTokens(node.test)) {
          if (token.type === 'Punctuator' && ['||', '&&', '??'].includes(token.value)) {
            pairs.push([token, source.getTokenAfter(token)]);
          }
        }

        for (const [left, right] of pairs) {
          const gap = source.text.slice(left.range[1], right.range[0]);

          if (!/^\s*$/.test(gap) || gap.includes('\n')) continue;

          context.report({
            node,
            messageId: 'newline',
            fix: (fixer) => fixer.replaceTextRange([left.range[1], right.range[0]], '\n'),
          });
        }
      },
    };
  },
};
