/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Monorepo Metro setup.
 *
 * `@vitalpe/domain`, `@vitalpe/types` and `@vitalpe/validation` are consumed as
 * TypeScript SOURCE (their package.json points `main` at src/index.ts), so
 * Metro has to watch the repository root and be allowed to resolve modules from
 * both the app's and the root's node_modules.
 *
 * With pnpm this only works if the install is hoisted — see the .npmrc note in
 * docs/MOBILE_SETUP.md. Metro does not follow pnpm's symlinked store reliably.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
