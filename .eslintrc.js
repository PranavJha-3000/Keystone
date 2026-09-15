/**
 * Root ESLint config — delegates to the shared config package.
 * All packages consume @keystone/config/eslint-preset.
 */
import baseConfig from './packages/config/eslint-preset.js';

export default [
  ...baseConfig,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      '**/.turbo/**',
    ],
  },
];
