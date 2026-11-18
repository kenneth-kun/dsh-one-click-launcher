import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LAUNCHER = path.join(ROOT, 'lib', 'launcher.cjs');
const tempDirs = [];

function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', `ocl-run-${label}-`));
  tempDirs.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function runLauncher(configPath, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [LAUNCHER, configPath],
      {
        timeout: 60000,
        env: Object.assign({ DSH_LAUNCHER_QUIET: '1' }, process.env, extraEnv),
      },
      (error, stdout, stderr) => resolve({ code: error ? error.code || 1 : 0, stdout, stderr }),
    );
  });
}

function writeConfig(dir, config) {
  const configPath = path.join(dir, 'launcher.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

function freePort() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test('cold start: spawns DSH, captures the token URL, saves and opens it', async () => {
  const dir = tempDir('cold');
  const port = await freePort();
  const stub = path.join(dir, 'fake-dsh.js');
  fs.writeFileSync(
    stub,
    [
      `console.log('dsh web: http://127.0.0.1:${port}/?token=TEST-TOKEN');`,
      'setTimeout(() => process.exit(0), 1500);',
    ].join('\n'),
  );
  const configPath = writeConfig(dir, {
    schema: 1,
    appName: 'DSH Web',
    port,
    profile: 'web',
    cwd: dir,
    command: { file: process.execPath, args: [stub] },
    fallback: { file: 'dsh', args: ['web', '--no-open', '--port', String(port)] },
  });
  const state = path.join(dir, 'state');
  const result = await runLauncher(configPath, {
    DSH_LAUNCHER_STATE_DIR: state,
    DSH_LAUNCHER_OPEN: 'print',
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`\\[open\\] http://127\\.0\\.0\\.1:${port}/\\?token=TEST-TOKEN`));
  const saved = fs.readFileSync(path.join(state, 'last-url.txt'), 'utf8').trim();
  assert.equal(saved, `http://127.0.0.1:${port}/?token=TEST-TOKEN`);
  assert.ok(fs.existsSync(path.join(state, 'dsh-web.log')));
});

test('already running: reuses the saved token URL when it still answers 3xx', async () => {
  const dir = tempDir('reuse');
  const state = path.join(dir, 'state');
  const tokenUrl = '/?token=STILL-VALID';
  const server = http.createServer((request, response) => {
    if (request.url === tokenUrl) {
      response.writeHead(303, { location: './' });
      response.end();
      return;
    }
    response.writeHead(401);
    response.end('authentication required');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'last-url.txt'), `http://127.0.0.1:${port}${tokenUrl}\n`);
  const configPath = writeConfig(dir, {
    schema: 1,
    port,
    profile: 'web',
    cwd: dir,
    command: { file: process.execPath, args: [path.join(dir, 'never-runs.js')] },
    fallback: { file: 'dsh', args: [] },
  });
  try {
    const result = await runLauncher(configPath, {
      DSH_LAUNCHER_STATE_DIR: state,
      DSH_LAUNCHER_OPEN: 'print',
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`\\[open\\] http://127\\.0\\.0\\.1:${port}/\\?token=STILL-VALID`));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('already running: falls back to the root URL when the token is stale', async () => {
  const dir = tempDir('stale');
  const state = path.join(dir, 'state');
  const server = http.createServer((request, response) => {
    response.writeHead(401);
    response.end('authentication required');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'last-url.txt'), `http://127.0.0.1:${port}/?token=STALE\n`);
  const configPath = writeConfig(dir, {
    schema: 1,
    port,
    profile: 'web',
    cwd: dir,
    command: null,
    fallback: { file: 'dsh', args: [] },
  });
  try {
    const result = await runLauncher(configPath, {
      DSH_LAUNCHER_STATE_DIR: state,
      DSH_LAUNCHER_OPEN: 'print',
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`\\[open\\] http://127\\.0\\.0\\.1:${port}/\\n`));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('unusable state directory: exits 1 with a clear message', async () => {
  const dir = tempDir('nostate');
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'not a directory\n');
  const configPath = writeConfig(dir, {
    schema: 1,
    port: 3999,
    profile: 'web',
    cwd: dir,
    command: null,
    fallback: { file: 'dsh', args: [] },
  });
  const result = await runLauncher(configPath, {
    DSH_LAUNCHER_STATE_DIR: path.join(blocker, 'state'),
    DSH_LAUNCHER_OPEN: 'print',
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /state directory|cannot create/);
});

test('invalid config: exit code 1 and no crash', async () => {
  const dir = tempDir('bad');
  const configPath = path.join(dir, 'launcher.json');
  fs.writeFileSync(configPath, '{"schema":1,"port":"not-a-port"}\n');
  const result = await runLauncher(configPath, {
    DSH_LAUNCHER_STATE_DIR: path.join(dir, 'state'),
    DSH_LAUNCHER_OPEN: 'print',
  });
  assert.equal(result.code, 1);
});
