import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { portFromHost, resolveLaunchCommand } from '../lib/command.js';
import {
  createShortcut,
  linuxDesktopEntry,
  macBundlePaths,
  macInfoPlist,
  removeShortcut,
  shortcutPath,
  winPaths,
} from '../lib/shortcuts.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ASSETS = path.join(ROOT, 'assets');
const tempDirs = [];

function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', `ocl-${label}-`));
  tempDirs.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const COMMAND = { file: '/opt/node/bin/node', args: ['/opt/dsh/lib/bin.js', 'web', '--no-open', '--port', '3080'] };

test('macOS: builds a complete .app bundle', () => {
  const desktop = tempDir('desktop-mac');
  const installDir = tempDir('install-mac');
  const result = createShortcut({
    platform: 'darwin',
    desktop,
    installDir,
    assetsDir: ASSETS,
    port: 3080,
    profile: 'web',
    cwd: '/Users/example',
    command: COMMAND,
  });

  const paths = macBundlePaths(desktop);
  assert.equal(result.path, paths.bundle);
  assert.equal(result.kind, 'app-bundle');
  for (const file of [paths.plist, paths.pkgInfo, paths.executable, paths.icon]) {
    assert.ok(fs.existsSync(file), `missing ${file}`);
  }
  assert.ok(fs.existsSync(path.join(paths.resources, 'launcher.cjs')));
  const config = JSON.parse(fs.readFileSync(path.join(paths.resources, 'launcher.json'), 'utf8'));
  assert.equal(config.port, 3080);
  assert.equal(config.profile, 'web');
  assert.deepEqual(config.command, COMMAND);
  assert.equal(config.fallback.file, 'dsh');

  const stub = fs.readFileSync(paths.executable, 'utf8');
  assert.match(stub, /^#!\/bin\/bash/);
  assert.match(stub, /launcher\.cjs/);
  assert.ok(stub.includes('/opt/node/bin/node'));
  assert.equal(fs.statSync(paths.executable).mode & 0o111, 0o111, 'stub must be executable');

  assert.match(fs.readFileSync(paths.plist, 'utf8'), /CFBundleExecutable[\s\S]*DSHWeb/);
});

test('macOS: plist escapes the display name', () => {
  const plist = macInfoPlist('A & B <web>');
  assert.match(plist, /A &amp; B &lt;web&gt;/);
});

test('Windows: writes the payload, VBS shim, CMD fallback and the .lnk script', () => {
  const desktop = tempDir('desktop-win');
  const installDir = tempDir('install-win');
  const scripts = [];
  const result = createShortcut({
    platform: 'win32',
    desktop,
    installDir,
    assetsDir: ASSETS,
    port: 3081,
    profile: 'web',
    cwd: 'C:\\Users\\example',
    command: { file: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\dsh\\lib\\bin.js', 'web'] },
    runPowerShell: (script) => {
      scripts.push(script);
      return { ok: true, stderr: '' };
    },
  });

  const paths = winPaths(desktop, installDir);
  assert.equal(result.kind, 'lnk');
  assert.equal(result.path, paths.lnk);
  for (const file of [paths.vbs, paths.cmd, paths.icon, path.join(installDir, 'launcher.cjs')]) {
    assert.ok(fs.existsSync(file), `missing ${file}`);
  }
  const vbs = fs.readFileSync(paths.vbs, 'utf8');
  assert.match(vbs, /shell\.Run """" & node & """ """ & scriptPath/);
  assert.ok(vbs.includes('C:\\Program Files\\nodejs\\node.exe'));
  const cmd = fs.readFileSync(paths.cmd, 'utf8');
  assert.match(cmd, /launcher\.cjs/);
  assert.ok(cmd.includes('\r\n'));

  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /CreateShortcut\('.*DSH Web\.lnk'\)/);
  assert.match(scripts[0], /wscript\.exe/);
  assert.match(scripts[0], /launch\.vbs/);
  assert.match(scripts[0], /\$s\.Save\(\)/);
});

test('Windows: falls back to a desktop .cmd when PowerShell fails', () => {
  const desktop = tempDir('desktop-win-fail');
  const installDir = tempDir('install-win-fail');
  const result = createShortcut({
    platform: 'win32',
    desktop,
    installDir,
    assetsDir: ASSETS,
    port: 3081,
    profile: 'web',
    cwd: 'C:\\Users\\example',
    command: null,
    runPowerShell: () => ({ ok: false, stderr: 'Access denied\n' }),
  });
  assert.equal(result.kind, 'cmd-fallback');
  assert.match(result.warning, /Access denied|\.cmd/);
  assert.ok(fs.existsSync(result.path));
});

test('Linux: writes a .desktop entry, launch script and menu copy', () => {
  const desktop = tempDir('desktop-linux');
  const installDir = tempDir('install-linux');
  const applicationsDir = tempDir('apps-linux');
  const result = createShortcut({
    platform: 'linux',
    desktop,
    installDir,
    applicationsDir,
    assetsDir: ASSETS,
    port: 3090,
    profile: 'web',
    cwd: '/home/example/projects',
    command: COMMAND,
  });

  assert.equal(result.kind, 'desktop-entry');
  assert.ok(fs.existsSync(path.join(desktop, 'DSH Web.desktop')));
  assert.ok(fs.existsSync(path.join(applicationsDir, 'dsh-one-click-launcher.desktop')));
  assert.equal(result.extras.length, 1);

  const entry = fs.readFileSync(result.path, 'utf8');
  assert.match(entry, /^\[Desktop Entry\]/);
  assert.match(entry, /^Type=Application$/m);
  assert.match(entry, /^Exec="/m);
  assert.match(entry, /^Path=\/home\/example\/projects$/m);
  assert.match(entry, /^Icon=/m);
  assert.equal(fs.statSync(result.path).mode & 0o111, 0o111, 'desktop file should be executable');

  const shell = fs.readFileSync(path.join(installDir, 'launch.sh'), 'utf8');
  assert.match(shell, /^#!\/bin\/sh/);
  assert.match(shell, /exec "\$NODE" "\$DIR\/launcher\.cjs"/);
  assert.ok(shell.includes('/opt/node/bin/node'));
});

test('linuxDesktopEntry quotes the Exec path', () => {
  const entry = linuxDesktopEntry({
    appName: 'DSH Web',
    shell: '/home/me/Library Application Support/launch.sh',
    icon: '/home/me/icon.png',
    cwd: '/home/me',
  });
  assert.match(entry, /Exec="\/home\/me\/Library Application Support\/launch\.sh"/);
});

test('removeShortcut cleans up every artifact', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const desktop = tempDir(`desktop-remove-${platform}`);
    const installDir = tempDir(`install-remove-${platform}`);
    const applicationsDir = platform === 'linux' ? tempDir('apps-remove') : null;
    createShortcut({
      platform,
      desktop,
      installDir,
      applicationsDir,
      assetsDir: ASSETS,
      port: 3080,
      profile: 'web',
      cwd: '/tmp',
      command: COMMAND,
      runPowerShell: () => ({ ok: true, stderr: '' }),
    });
    const target = shortcutPath({ platform, desktop });
    assert.ok(fs.existsSync(target), `${platform}: shortcut should exist first`);
    const removed = removeShortcut({ platform, desktop, installDir, applicationsDir });
    assert.ok(removed.length > 0);
    assert.ok(!fs.existsSync(target), `${platform}: shortcut should be gone`);
    if (platform !== 'darwin') {
      assert.ok(!fs.existsSync(installDir), `${platform}: payload dir should be gone`);
    }
  }
});

test('resolveLaunchCommand: reuses the running node + bin.js', () => {
  const dir = tempDir('command');
  const bin = path.join(dir, 'bin.js');
  fs.writeFileSync(bin, '// fake\n');
  const resolved = resolveLaunchCommand({
    argv: [process.execPath, bin, 'web'],
    execPath: process.execPath,
    port: 3080,
  });
  assert.equal(resolved.profile, 'web');
  assert.equal(resolved.command.file, process.execPath);
  assert.deepEqual(resolved.command.args, [bin, 'web', '--no-open', '--port', '3080']);
  assert.deepEqual(resolved.fallback.args, ['web', '--no-open', '--port', '3080']);
});

test('resolveLaunchCommand: falls back to `dsh` when argv[1] is not a script', () => {
  const resolved = resolveLaunchCommand({ argv: ['/Applications/DSH.app/Contents/MacOS/DSH'], port: 3080 });
  assert.equal(resolved.command, null);
  assert.equal(resolved.fallback.file, 'dsh');
  assert.equal(resolved.profile, 'web');
});

test('portFromHost parses the Host header', () => {
  assert.equal(portFromHost('127.0.0.1:3080'), 3080);
  assert.equal(portFromHost('localhost:8080'), 8080);
  assert.equal(portFromHost('127.0.0.1'), null);
  assert.equal(portFromHost(undefined), null);
});
