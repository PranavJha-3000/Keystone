/*
 * CJS syntax + direct plugin wiring (not style choices):
 * 1. This app package.json has no "type": "module" — CJS matches the package
 *    type and avoids jiti's ESM reparse of this file.
 * 2. eslint-config-next is deliberately NOT used. Its index.js requires
 *    @rushstack/eslint-patch/modern-module-resolution, which cannot patch
 *    ESLint 9's flat-config loader (crashes: "Failed to patch ESLint because
 *    the calling module was not recognized" — the patch walks the CJS
 *    module.parent chain, which jiti's loader does not preserve). Instead the
 *    same rules come from @next/eslint-plugin-next's native flat configs plus
 *    eslint-plugin-react-hooks' flat config.
 */
const baseConfig = require('@keystone/config/eslint-preset').default;
const nextPlugin = require('@next/eslint-plugin-next');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = [
  ...baseConfig,
  nextPlugin.flatConfig.recommended,
  nextPlugin.flatConfig.coreWebVitals,
  reactHooks.configs['recommended-latest'],
];
