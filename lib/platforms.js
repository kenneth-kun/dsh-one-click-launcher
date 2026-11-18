/**
 * Platform facts: which OS we are generating for, where its desktop and
 * per-user data directories live, and how to quote paths for each target.
 *
 * The platform is normally `process.platform`, but tests (and dry runs on
 * another machine) may override it with DSH_LAUNCHER_PLATFORM.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'DSH Web';
export const APP_SLUG = 'dsh-one-click-launcher';

/** @returns {'darwin' | 'win32' | 'linux'} */
export function currentPlatform() {
  const override = process.env.DSH_LAUNCHER_PLATFORM;
  if (override === 'darwin' || override === 'win32' || override === 'linux') return override;
  if (process.platform === 'darwin' || process.platform === 'win32') return process.platform;
  return 'linux';
}

export function homeDir() {
  return process.env.DSH_LAUNCHER_HOME || os.homedir();
}

/** User's Desktop directory, honouring XDG on Linux and shell folders on Windows. */
export function desktopDir(platform = currentPlatform()) {
  if (process.env.DSH_LAUNCHER_DESKTOP) return process.env.DSH_LAUNCHER_DESKTOP;
  const home = homeDir();
  if (platform === 'win32') {
    const found = windowsShellFolder('Desktop');
    return found || path.join(home, 'Desktop');
  }
  if (platform === 'linux') {
    const xdg = runQuiet('xdg-user-dir', ['DESKTOP']);
    if (xdg && (xdg.startsWith('/') || /^[A-Za-z]:/.test(xdg))) return xdg;
  }
  return path.join(home, 'Desktop');
}

/** Where the launcher payload (script, config, icons) is copied to. */
export function installDir(platform = currentPlatform()) {
  if (process.env.DSH_LAUNCHER_DIR) return process.env.DSH_LAUNCHER_DIR;
  const home = homeDir();
  if (platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(base, APP_SLUG);
  }
  if (platform === 'linux') {
    const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    return path.join(xdg, APP_SLUG);
  }
  return path.join(home, 'Library', 'Application Support', APP_SLUG);
}

/** Autostart-style application entry (Linux only) for launchpad/menu visibility. */
export function applicationsDir(platform = currentPlatform()) {
  const home = homeDir();
  if (platform === 'linux') {
    const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    return path.join(xdg, 'applications');
  }
  return null;
}

function runQuiet(command, args) {
  try {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 3000, windowsHide: true });
    if (result.status !== 0) return '';
    return String(result.stdout || '').trim();
  } catch {
    return '';
  }
}

function windowsShellFolder(name) {
  const script = `[Environment]::GetFolderPath('${name}')`;
  const found = runQuiet('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
  if (found && /^[A-Za-z]:/.test(found)) return found;
  return '';
}

export function existsOrNull(target) {
  return target && target.length > 0 ? target : null;
}

/** Escape for a single-quoted POSIX shell string. */
export function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** Escape for a double-quoted VBScript string. */
export function vbsString(value) {
  return String(value).replace(/"/g, '""');
}

/** Escape for a double-quoted PowerShell string. */
export function psString(value) {
  return String(value).replace(/"/g, '`"').replace(/\$/g, '`$');
}

/** Escape for a double-quoted .desktop Exec argument. */
export function desktopQuote(value) {
  const text = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${text}"`;
}

/** Escape XML text nodes / attribute values. */
export function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
