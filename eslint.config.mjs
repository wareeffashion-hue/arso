import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/next.config.ts',
      '**/vitest.config.ts',
      '**/.next/**',
      '**/node_modules/**',
      '**/drizzle/**',
      'brand/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // المال لا يُمثَّل بـ number: استخدم Money من @arso/domain
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'ممنوع parseFloat: استخدم Decimal من @arso/domain للمبالغ.',
        },
      ],
    },
  },
);
