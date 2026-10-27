export default {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    messages: { newline: 'Put each named import on its own line.' },
  },
  create(context) {
    const source = context.sourceCode;

    return {
      ImportDeclaration(node) {
        const names = node.specifiers.filter((item) => item.type === 'ImportSpecifier');

        // Remove empty lines inside import braces, without touching comments.
        const tokens = source.getTokens(node);

        for (let index = 1; index < tokens.length; index++) {
          const left = tokens[index - 1];
          const right = tokens[index];
          const gap = source.text.slice(left.range[1], right.range[0]);

          if (!/^\s+$/.test(gap)) continue;

          const compact = names.length < 3;
          const needsFix = compact ? /[\r\n]/.test(gap) : (gap.match(/\n/g) || []).length > 1;

          if (!needsFix) continue;

          context.report({
            node,
            messageId: 'newline',
            fix: (fixer) => fixer.replaceTextRange(
              [left.range[1], right.range[0]],
              compact ? ' ' : '\n' + gap.slice(gap.lastIndexOf('\n') + 1),
            ),
          });
        }

        if (names.length < 3) return;

        for (let index = 1; index < names.length; index++) {
          const previous = names[index - 1];
          const current = names[index];

          if (previous.loc.end.line !== current.loc.start.line) continue;

          const comma = source.getTokenAfter(previous);

          context.report({
            node: current,
            messageId: 'newline',
            fix: (fixer) => fixer.insertTextAfter(comma, '\n'),
          });
        }
      },
    };
  },
};
