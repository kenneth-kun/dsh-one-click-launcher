/**
 * Work out what a double-click should execute to start the same DSH that is
 * serving this page.
 *
 * The host process was started as `node <dsh>/lib/bin.js <profile> …`, so the
 * most reliable command is that exact triple: the running Node binary, the
 * resolved `bin.js`, and the profile. When that information is unavailable
 * (for example an Electron desktop shell that boots the host in-process) we
 * fall back to the `dsh` executable on PATH.
 */
import fs from 'node:fs';

/** Profile the host was booted with, e.g. `web`. */
export function detectProfile(argv = process.argv) {
  const candidate = argv[2];
  if (typeof candidate === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(candidate)) {
    return { profile: candidate, explicit: true };
  }
  return { profile: 'web', explicit: false };
}

/**
 * @returns {{
 *   profile: string,
 *   cwd: string,
 *   command: { file: string, args: string[] } | null,
 *   fallback: { file: string, args: string[] },
 * }}
 */
export function resolveLaunchCommand(options = {}) {
  const {
    argv = process.argv,
    execPath = process.execPath,
    port,
    exists = (target) => fs.existsSync(target),
  } = options;
  const { profile } = detectProfile(argv);
  const args = [profile, '--no-open', '--port', String(port)];
  const binJs = typeof argv[1] === 'string' ? argv[1] : '';
  const usableNode = typeof execPath === 'string' && execPath.length > 0 && exists(execPath);
  const usableBin = binJs.length > 0 && /\.[cm]?js$/i.test(binJs) && exists(binJs);
  return {
    profile,
    cwd: process.cwd(),
    command: usableNode && usableBin ? { file: execPath, args: [binJs, ...args] } : null,
    fallback: { file: 'dsh', args },
  };
}

/** Port this host is listening on, taken from the browser's Host header. */
export function portFromHost(hostHeader) {
  if (typeof hostHeader !== 'string') return null;
  const match = /:(\d{1,5})$/.exec(hostHeader);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isSafeInteger(port) && port > 0 && port <= 65535 ? port : null;
}
