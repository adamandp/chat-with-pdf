import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';
import noPaddedContainers from './tooling/eslint/no-padded-containers.mjs';
import chainStart from './tooling/eslint/chain-start.mjs';
import importLines from './tooling/eslint/import-lines.mjs';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'src/generated/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@stylistic': stylistic, '@typescript-eslint': tseslint.plugin, 'unused-imports': unusedImports, local: { rules: { 'no-padded-containers': noPaddedContainers, 'chain-start': chainStart, 'import-lines': importLines } } },
    rules: {
      'unused-imports/no-unused-imports': 'error',
      'local/no-padded-containers': 'error',
      'local/chain-start': 'error',
      'local/import-lines': 'error',
      '@stylistic/newline-per-chained-call': ['error', { ignoreChainWithDepth: 1 }],
      ...stylistic.configs.customize({ indent: 2, quotes: 'single', semi: true, jsx: false }).rules,
      '@stylistic/object-curly-newline': [
        'error',
        {
          ObjectExpression: { multiline: true, minProperties: 2, consistent: true },
          ObjectPattern: { multiline: true, consistent: true },
          ImportDeclaration: { multiline: false, minProperties: 3, consistent: false },
          ExportDeclaration: { multiline: true, consistent: true },
        },
      ],
      '@stylistic/object-property-newline': [
        'error',
        { allowAllPropertiesOnSameLine: false },
      ],
      '@stylistic/brace-style': [
        'error',
        '1tbs',
        { allowSingleLine: true },
      ],
      '@stylistic/arrow-parens': [
        'error',
        'always',
      ],
      '@stylistic/array-bracket-newline': [
        'error',
        { minItems: 2, multiline: true },
      ],
      '@stylistic/array-element-newline': [
        'error',
        { minItems: 2, multiline: true },
      ],
      '@stylistic/padding-line-between-statements': [
        'error',
        {
          blankLine: 'always',
          prev: '*',
          next: [
            'const',
            'let',
            'var',
          ],
        },
        {
          blankLine: 'always',
          prev: [
            'const',
            'let',
            'var',
          ],
          next: '*',
        },
        { blankLine: 'always', prev: '*', next: 'return' },
      ],
      '@stylistic/lines-between-class-members': [
        'error',
        'always',
      ],
    },
  },
];
