/**
 * Publishing guard: run the test suite when the local Node understands
 * `node --test` (>= 18), otherwise warn and let the publish proceed.
 *
 * Why: `npm publish` runs `prepublishOnly` with whatever `node` is first on
 * PATH. A machine can point that at an old runtime while the DSH host that
 * runs the plugin uses a modern one — an old Node must not block a release.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const major = Number(String(process.versions.node).split('.')[0]);
if (!Number.isFinite(major) || major < 18) {
  console.warn(
    `[verify] local node is ${process.versions.node}, which has no "node --test"; ` +
      'skipping the test suite. Run `npm test` with the DSH host node instead.',
  );
  process.exit(0);
}

const dir = path.join(process.cwd(), 'test');
const files = fs.existsSync(dir)
  ? fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.test.js'))
      .map((name) => path.join('test', name))
  : [];

if (files.length === 0) {
  console.warn('[verify] no test files found; skipping');
  process.exit(0);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
