#!/usr/bin/env node
/**
 * DSH one-click launcher runtime.
 *
 * This file is the only piece of the plugin that runs *outside* the DSH host:
 * every desktop shortcut the plugin generates (macOS .app, Windows .lnk +
 * wscript, Linux .desktop) ends up executing this script with a
 * `launcher.json` config next to it.
 *
 * Responsibilities, in order:
 *   1. If DSH is already listening on the configured port, reuse it — prefer
 *      the saved process-token URL (a 3xx from the host re-mints the login
 *      cookie), otherwise open the plain root URL.
 *   2. Otherwise start `dsh <profile> --no-open --port <port>` detached, wait
 *      for the `dsh web: http://…/?token=…` line in its log, and open that.
 *   3. On failure, surface a native dialog (best effort) plus the log path.
 *
 * Plain CommonJS with Node built-ins only: it must keep working after the
 * plugin (and its node_modules) has been uninstalled, on every OS, forever.
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const APP_DIR_STATE = 'dsh-one-click-launcher';
const LOCK_STALE_MS = 2 * 60 * 1000;
const STARTUP_TIMEOUT_MS = 90 * 1000;
const PROBE_TIMEOUT_MS = 1500;

/** Where this launcher was copied to (the .app Resources dir, %LOCALAPPDATA%, …). */
const here = __dirname;

function readConfig() {
  const fromArgv = process.argv[2];
  const candidate = fromArgv ? path.resolve(fromArgv) : path.join(here, 'launcher.json');
  const raw = fs.readFileSync(candidate, 'utf8');
  const config = JSON.parse(raw);
  if (!config || typeof config !== 'object') throw new Error('launcher.json is not an object');
  const port = Number(config.port);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`launcher.json has an invalid port: ${String(config.port)}`);
  }
  return { config, configPath: candidate, port };
}

/** Log/state directory, per platform (overridable for tests). */
function stateDir() {
  const override = process.env.DSH_LAUNCHER_STATE_DIR;
  if (override) return override;
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Logs', APP_DIR_STATE);
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(base, APP_DIR_STATE, 'logs');
  }
  const xdg = process.env.XDG_STATE_HOME || path.join(home, '.local', 'state');
  return path.join(xdg, APP_DIR_STATE);
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* best effort */
  }
  return dir;
}

/** HTTP status of a URL, or null when nothing is listening. */
function probe(url) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let request;
    try {
      request = http.get(url, { timeout: PROBE_TIMEOUT_MS }, (response) => {
        done(response.statusCode || 0);
        response.resume();
      });
    } catch {
      done(null);
      return;
    }
    request.on('timeout', () => {
      request.destroy();
      done(null);
    });
    request.on('error', () => done(null));
  });
}

function openBrowser(url) {
  if (process.env.DSH_LAUNCHER_OPEN === 'print') {
    // Used by tests and headless setup verification.
    process.stdout.write(`[open] ${url}\n`);
    return true;
  }
  const options = { detached: true, stdio: 'ignore', windowsHide: true };
  if (process.platform === 'darwin') {
    spawn('open', [url], options).unref();
    return true;
  }
  if (process.platform === 'win32') {
    // `start` needs a (possibly empty) window title before the URL.
    spawn('cmd.exe', ['/c', `start "" "${url.replace(/"/g, '')}"`], {
      ...options,
      windowsVerbatimArguments: true,
    }).unref();
    return true;
  }
  for (const [file, args] of [
    ['xdg-open', [url]],
    ['gio', ['open', url]],
    ['sensible-browser', [url]],
  ]) {
    try {
      const child = spawn(file, args, options);
      child.on('error', () => {});
      child.unref();
      return true;
    } catch {
      /* try the next opener */
    }
  }
  return false;
}

/** Best-effort native error dialog; never throws. */
function reportFailure(message, logFile) {
  const text = `${message}${logFile ? `\n\nLog: ${logFile}` : ''}`;
  if (process.env.DSH_LAUNCHER_QUIET === '1' || process.env.DSH_LAUNCHER_OPEN === 'print') {
    process.stderr.write(`[launcher] ${text}\n`);
    return;
  }
  try {
    if (process.platform === 'darwin') {
      spawnSync('osascript', [
        '-e',
        `display alert "DSH Web" message "${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" as warning`,
      ]);
      return;
    }
    if (process.platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName PresentationFramework;',
        `[System.Windows.MessageBox]::Show("${text.replace(/"/g, '`"')}","DSH Web") | Out-Null`,
      ].join(' ');
      spawnSync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
      return;
    }
    spawnSync('zenity', ['--error', '--title=DSH Web', `--text=${text}`]);
  } catch {
    /* dialogs are optional */
  }
}

function readTail(file, maxBytes = 8192) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(maxBytes, stat.size));
      fs.readSync(fd, buffer, 0, buffer.length, start);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

/** `dsh web: http://127.0.0.1:3080/?token=…` → the token URL. */
function extractUrl(text, port) {
  const pattern = new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=[^\\s"'<>]+`, 'g');
  const matches = text.match(pattern);
  return matches ? matches[matches.length - 1] : null;
}

/** Directories worth searching for `dsh` when a GUI launch has a minimal PATH. */
function candidateDirs() {
  const home = os.homedir();
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extra = [
    path.join(home, '.workbuddy', 'binaries', 'node', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    extra.push(path.join(local, 'Programs', 'nodejs'), path.join(local, 'npm'), 'C:\\Program Files\\nodejs');
  }
  const seen = new Set();
  const result = [];
  for (const dir of [...dirs, ...extra]) {
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(dir);
  }
  return result;
}

/** Absolute path for an executable name, or the name unchanged. */
function which(name) {
  if (!name) return name;
  if (name.includes('/') || name.includes('\\')) return name;
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];
  for (const dir of candidateDirs()) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return name;
}

/** Resolve the configured executable, falling back to `dsh` on PATH. */
function resolveCommand(config) {
  const command = config.command && typeof config.command === 'object' ? config.command : null;
  if (command && typeof command.file === 'string' && command.file) {
    const args = Array.isArray(command.args) ? command.args.map(String) : [];
    if (fs.existsSync(command.file)) return { file: command.file, args };
  }
  const fallback = config.fallback && typeof config.fallback === 'object' ? config.fallback : null;
  if (fallback && typeof fallback.file === 'string' && fallback.file) {
    return {
      file: which(fallback.file),
      args: Array.isArray(fallback.args) ? fallback.args.map(String) : [],
    };
  }
  const args = Array.isArray(config.args) ? config.args.map(String) : [];
  return { file: which('dsh'), args };
}

function acquireLock(dir, attempt = 0) {
  const lockFile = path.join(dir, 'launcher.lock');
  try {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return {
      release() {
        try {
          fs.unlinkSync(lockFile);
        } catch {
          /* already gone */
        }
      },
    };
  } catch (error) {
    let stat = null;
    try {
      stat = fs.statSync(lockFile);
    } catch {
      stat = null;
    }
    if (stat === null) {
      // No lock file to inspect: either it vanished between the two calls or
      // the state directory is not writable. Retry once, then report loudly.
      if (attempt === 0) return acquireLock(dir, 1);
      throw new Error(`cannot create ${lockFile}: ${error && error.code ? error.code : error}`);
    }
    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
      try {
        fs.unlinkSync(lockFile);
      } catch {
        /* someone else cleaned it */
      }
      return acquireLock(dir, attempt + 1);
    }
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openExisting(port, dir) {
  const urlFile = path.join(dir, 'last-url.txt');
  let saved = '';
  try {
    saved = fs.readFileSync(urlFile, 'utf8').trim();
  } catch {
    saved = '';
  }
  if (saved) {
    const code = await probe(saved);
    if (typeof code === 'number' && code >= 300 && code < 400) {
      openBrowser(saved);
      return true;
    }
  }
  openBrowser(`http://127.0.0.1:${port}/`);
  return true;
}

async function startServer(config, port, dir) {
  const logFile = path.join(dir, 'dsh-web.log');
  const urlFile = path.join(dir, 'last-url.txt');
  const command = resolveCommand(config);
  const cwd = typeof config.cwd === 'string' && fs.existsSync(config.cwd) ? config.cwd : os.homedir();

  let fd;
  try {
    fd = fs.openSync(logFile, 'a');
  } catch {
    fd = 'ignore';
  }
  try {
    fs.appendFileSync(
      logFile,
      `\n=== ${new Date().toISOString()} launching ${command.file} ${command.args.join(' ')} ===\n`,
    );
  } catch {
    /* logging is best effort */
  }

  let child;
  try {
    child = spawn(command.file, command.args, {
      cwd,
      detached: true,
      stdio: ['ignore', fd, fd],
      windowsHide: true,
      env: process.env,
    });
  } catch (error) {
    reportFailure(`Could not start DSH: ${error && error.message ? error.message : error}`, logFile);
    return false;
  }
  child.unref();

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(500);
    const url = extractUrl(readTail(logFile, 65536), port);
    if (url) {
      try {
        fs.writeFileSync(urlFile, `${url}\n`);
      } catch {
        /* state is best effort */
      }
      openBrowser(url);
      return true;
    }
    if (child.exitCode !== null && child.exitCode !== 0) break;
  }

  const tail = readTail(logFile, 4096).trim();
  const hint = child.exitCode !== null ? `DSH exited with code ${child.exitCode}.` : 'DSH did not report a URL in time.';
  reportFailure(`${hint}\n\n${tail || '(no output)'}`, logFile);
  return false;
}

async function main() {
  let loaded;
  try {
    loaded = readConfig();
  } catch (error) {
    reportFailure(`The launcher configuration is missing or invalid.\n${error && error.message ? error.message : error}`);
    return 1;
  }
  const { config, port } = loaded;
  const dir = ensureDir(stateDir());
  let lock;
  try {
    lock = acquireLock(dir);
  } catch (error) {
    reportFailure(`Cannot use the launcher state directory.\n${error && error.message ? error.message : error}`);
    return 1;
  }
  if (!lock) return 0;

  try {
    const code = await probe(`http://127.0.0.1:${port}/`);
    if (code !== null) {
      await openExisting(port, dir);
      return 0;
    }
    return (await startServer(config, port, dir)) ? 0 : 1;
  } finally {
    lock.release();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    reportFailure(`Unexpected launcher error: ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  },
);
