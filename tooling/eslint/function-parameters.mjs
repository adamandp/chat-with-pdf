export default {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    messages: {
      newline: 'Put each parameter on its own line when the signature exceeds 80 columns.',
      decorator: 'Put parameter decorators on separate lines when the parameter exceeds 80 columns.',
    },
  },
  create(context) {
    const source = context.sourceCode;

    function firstParameterToken(param) {
      return source.getFirstToken(param.decorators?.[0] ?? param);
    }

    function check(node) {
      if (!node.params.length) return;

      for (const param of node.params) {
        const decorators = param.decorators ?? [];

        if (!decorators.length || param.loc.end.column <= 80) continue;

        for (const decorator of decorators) {
          const last = source.getLastToken(decorator);
          const next = source.getTokenAfter(last);
          const gap = source.text.slice(last.range[1], next.range[0]);

          if (!/^\s*$/.test(gap) || gap.includes('\n')) continue;

          context.report({
            node: decorator,
            messageId: 'decorator',
            fix: (fixer) => fixer.replaceTextRange([last.range[1], next.range[0]], '\n'),
          });
        }
      }

      const first = firstParameterToken(node.params[0]);
      const open = source.getTokenBefore(first);

      // Unparenthesized arrow functions need no parameter wrapping.
      if (open.value !== '(') return;

      const last = source.getLastToken(node.params.at(-1));
      const after = source.getTokenAfter(last);
      const close = after.value === ',' ? source.getTokenAfter(after) : after;
      const end = node.returnType ?? close;

      if (open.loc.start.line !== end.loc.end.line || end.loc.end.column <= 80) return;

      const pairs = node.params.map((param) => {
        const token = firstParameterToken(param);

        return [source.getTokenBefore(token), token];
      });

      pairs.push([after.value === ',' ? after : last, close]);

      for (const [left, right] of pairs) {
        const gap = source.text.slice(left.range[1], right.range[0]);

        // Leave comments intact; only replace whitespace.
        if (!/^\s*$/.test(gap) || gap.includes('\n')) continue;

        context.report({
          node,
          messageId: 'newline',
          fix: (fixer) => fixer.replaceTextRange([left.range[1], right.range[0]], '\n'),
        });
      }
    }

    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
      TSDeclareFunction: check,
      TSEmptyBodyFunctionExpression: check,
    };
  },
};
