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

/**
 * The shared packages are ESM TypeScript: they import siblings as `./foo.js`
 * while the file on disk is `./foo.ts`. That is required by NodeNext and is
 * what the web build already understands, but Metro resolves the specifier
 * literally and fails.
 *
 * So a relative `.js` specifier that does not exist is retried as `.ts`/`.tsx`
 * before giving up. Scoped to relative paths inside the repo, so nothing in
 * node_modules changes behaviour.
 */
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const withoutExtension = moduleName.slice(0, -'.js'.length);
    for (const candidate of [`${withoutExtension}.ts`, `${withoutExtension}.tsx`]) {
      try {
        return resolve(context, candidate, platform);
      } catch {
        // Fall through to the original specifier below.
      }
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
