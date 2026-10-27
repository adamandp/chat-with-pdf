import { format } from 'sql-formatter';

export default {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    messages: { format: 'Format this raw SQL query.' },
  },
  create(context) {
    const source = context.sourceCode;

    return {
      TaggedTemplateExpression(node) {
        const tag = node.tag;

        if (tag.type !== 'MemberExpression' || tag.computed
          || !['$queryRaw', '$executeRaw'].includes(tag.property.name)) return;

        const { quasis, expressions } = node.quasi;
        const raw = quasis.map((part) => part.value.raw);

        // Leave escape sequences alone: raw and cooked template values differ.
        if (raw.some((part) => /[\\`]/.test(part) || part.includes('__CODEX_SQL_PARAM_'))) return;

        const marker = (index) => `__CODEX_SQL_PARAM_${index}__`;
        const sql = raw.map((part, index) => part + (index < expressions.length ? marker(index) : '')).join('');
        let formatted;

        try {
          formatted = format(sql, {
            language: 'postgresql',
            tabWidth: 2,
            keywordCase: 'preserve',
            paramTypes: { custom: [{ regex: '__CODEX_SQL_PARAM_[0-9]+__' }] },
          });
        } catch {
          // Incomplete SQL while typing must not prevent other save fixes.
          return;
        }

        const markers = formatted.match(/__CODEX_SQL_PARAM_[0-9]+__/g) || [];

        if (markers.length !== expressions.length || markers.some((value, index) => value !== marker(index))) return;

        const line = source.lines[node.loc.start.line - 1];
        const indent = line.match(/^\s*/)[0];
        const body = formatted.trim().split('\n').map((line) => indent + '  ' + line).join('\n');
        const restored = body.replace(/__CODEX_SQL_PARAM_([0-9]+)__/g,
          (_, index) => '${' + source.getText(expressions[Number(index)]) + '}');
        const replacement = '`\n' + restored + '\n' + indent + '`';

        if (source.getText(node.quasi) === replacement) return;

        context.report({
          node: node.quasi,
          messageId: 'format',
          fix: (fixer) => fixer.replaceText(node.quasi, replacement),
        });
      },
    };
  },
};
