import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Repository root, found by walking up from cwd to the workspace marker.
 *
 * Deliberately NOT `new URL('../..', import.meta.url)`: these modules are
 * consumed both by tsx (where that trick works) and by the web bundle (where
 * `import.meta.url` points into `.next` build output and the trick silently
 * resolves to the wrong directory — and Turbopack additionally tries to
 * resolve the URL as a build asset and fails the compile). cwd is the one
 * thing both runtimes agree on: repo root for the CLI, `apps/web` for Next,
 * and the marker walk absorbs the difference.
 */
export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
