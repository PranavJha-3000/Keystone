/**
 * Shared Prettier configuration for all Keystone packages.
 * Each package re-exports this via export default.
 */
/** @type {import("prettier").Options} */
export default {
  semi: true,
  trailingComma: 'all',
  singleQuote: true,
  printWidth: 100,
  tabWidth: 2,
  arrowParens: 'always',
  endOfLine: 'lf',
};
