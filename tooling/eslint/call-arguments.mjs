export default {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    messages: { newline: 'Put each argument on its own line.' },
  },
  create(context) {
    const source = context.sourceCode;

    function check(node) {
      const args = node.arguments;

      const longLine = node.loc.start.line === node.loc.end.line && node.loc.end.column > 80;

      if (!args.length || (!longLine && (args.length < 2 || (args.length < 3 && !args.some((arg) => arg.loc.start.line !== arg.loc.end.line))))) return;

      const pairs = args.map((arg) => [source.getTokenBefore(arg), source.getFirstToken(arg)]);
      const last = source.getLastToken(args[args.length - 1]);
      const next = source.getTokenAfter(last);

      pairs.push(next.value === ',' ? [next, source.getTokenAfter(next)] : [last, next]);

      for (const [left, right] of pairs) {
        const gap = source.text.slice(left.range[1], right.range[0]);

        // Preserve any comments between arguments.
        if (!/^\s*$/.test(gap) || gap.includes('\n')) continue;

        context.report({
          node,
          messageId: 'newline',
          fix: (fixer) => fixer.replaceTextRange([left.range[1], right.range[0]], '\n'),
        });
      }
    }

    return { CallExpression: check, NewExpression: check };
  },
};
