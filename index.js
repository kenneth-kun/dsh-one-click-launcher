/**
 * DSH one-click launcher — host half.
 *
 * Exposes three same-origin HTTP routes to the browser half so the settings
 * page can create, inspect and remove a desktop shortcut for the *current*
 * machine:
 *
 *   GET  /plugins/one-click-launcher/status
 *   POST /plugins/one-click-launcher/create
 *   POST /plugins/one-click-launcher/remove
 *
 * Nothing here touches the DSH core: the plugin only writes a launcher payload
 * plus an OS-appropriate wrapper (`.app` / `.lnk` / `.desktop`) into the user's
 * desktop and data directories.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { portFromHost, resolveLaunchCommand } from './lib/command.js';
import {
  APP_NAME,
  APP_SLUG,
  applicationsDir,
  currentPlatform,
  desktopDir,
  installDir,
} from './lib/platforms.js';
import { createShortcut, removeShortcut, shortcutPath } from './lib/shortcuts.js';

export const name = APP_SLUG;
export const inject = ['webServer'];

const BASE = '/plugins/one-click-launcher';
const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(PACKAGE_DIR, 'assets');

const PLATFORM_LABELS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function sendJson(response, status, value) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

/**
 * CSRF fence: the server only binds loopback, and every mutation must come
 * from that same origin (or from the official desktop shell's `dsh-app:`).
 */
function isSameOrigin(request) {
  const host = request.headers.host;
  if (typeof host !== 'string' || host.length === 0) return false;
  const hostname = host.split(':')[0].toLowerCase();
  if (!LOOPBACK_HOSTS.has(hostname)) return false;
  const origin = request.headers.origin;
  if (origin === undefined || origin === '') return true;
  try {
    const url = new URL(origin);
    if (url.protocol === 'dsh-app:') return true;
    return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Absolute assets dir, verified so a broken install fails loudly. */
function assetsDir() {
  return fs.existsSync(path.join(ASSETS_DIR, 'icon.icns')) || fs.existsSync(path.join(ASSETS_DIR, 'icon.ico'))
    ? ASSETS_DIR
    : null;
}

function resolvePort(request, config) {
  const fromRequest = portFromHost(request.headers.host);
  if (fromRequest) return fromRequest;
  const configured = Number(config.port);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 3080;
}

function statusFor({ platform, port, config, launch }) {
  const desktop = desktopDir(platform);
  const target = shortcutPath({ platform, desktop, appName: config.appName || APP_NAME });
  const installed = fs.existsSync(target);
  return {
    platform,
    platformLabel: PLATFORM_LABELS[platform] || platform,
    desktop,
    installed,
    shortcutPath: target,
    installDir: platform === 'darwin' ? null : installDir(platform),
    port,
    profile: launch ? launch.profile : null,
    command: launch ? launch.command : null,
    appName: config.appName || APP_NAME,
    assetsReady: assetsDir() !== null,
    home: process.env.DSH_LAUNCHER_HOME || null,
  };
}

/**
 * @param {object} ctx - cordis host context.
 * @param {{ port?: number, profile?: string, appName?: string }} [config]
 */
export function apply(ctx, config = {}) {
  ctx.inject(['webServer'], (host) => {
    const webServer = host.webServer;
    const register = (route) => host.effect(() => webServer.register(route), `one-click-launcher: ${route.path}`);

    register({
      kind: 'exact',
      path: `${BASE}/status`,
      handler: (request, response) => {
        try {
          if (request.method !== 'GET') {
            sendJson(response, 405, { ok: false, error: 'method not allowed' });
            return;
          }
          const platform = currentPlatform();
          const port = resolvePort(request, config);
          const launch = resolveLaunchCommand({ port });
          sendJson(response, 200, { ok: true, ...statusFor({ platform, port, config, launch }) });
        } catch (error) {
          sendJson(response, 500, { ok: false, error: String(error && error.message ? error.message : error) });
        }
      },
    });

    register({
      kind: 'exact',
      path: `${BASE}/create`,
      handler: (request, response) => {
        if (request.method !== 'POST') {
          sendJson(response, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        if (!isSameOrigin(request)) {
          sendJson(response, 403, { ok: false, error: 'untrusted origin' });
          return;
        }
        try {
          const assets = assetsDir();
          if (!assets) throw new Error('plugin assets are missing (icon.*)');
          const platform = currentPlatform();
          const port = resolvePort(request, config);
          const launch = resolveLaunchCommand({ port });
          const result = createShortcut({
            platform,
            desktop: desktopDir(platform),
            installDir: installDir(platform),
            applicationsDir: applicationsDir(platform),
            assetsDir: assets,
            port,
            profile: launch.profile,
            cwd: launch.cwd,
            command: launch.command,
            appName: config.appName || APP_NAME,
          });
          ctx.logger?.info?.(`one-click-launcher: created ${result.path}`);
          sendJson(response, 200, {
            ok: true,
            created: result,
            ...statusFor({ platform, port, config, launch }),
          });
        } catch (error) {
          const message = String(error && error.message ? error.message : error);
          ctx.logger?.warn?.(`one-click-launcher: create failed: ${message}`);
          sendJson(response, 500, { ok: false, error: message });
        }
      },
    });

    register({
      kind: 'exact',
      path: `${BASE}/remove`,
      handler: (request, response) => {
        if (request.method !== 'POST') {
          sendJson(response, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        if (!isSameOrigin(request)) {
          sendJson(response, 403, { ok: false, error: 'untrusted origin' });
          return;
        }
        try {
          const platform = currentPlatform();
          const port = resolvePort(request, config);
          const removed = removeShortcut({
            platform,
            desktop: desktopDir(platform),
            installDir: installDir(platform),
            applicationsDir: applicationsDir(platform),
            appName: config.appName || APP_NAME,
          });
          const launch = resolveLaunchCommand({ port });
          sendJson(response, 200, { ok: true, removed, ...statusFor({ platform, port, config, launch }) });
        } catch (error) {
          sendJson(response, 500, { ok: false, error: String(error && error.message ? error.message : error) });
        }
      },
    });
  });
}
