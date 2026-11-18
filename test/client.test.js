import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLIENT = path.join(ROOT, 'client.js');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** Load client.js in a fake module-loader browser, returning the registered bundle. */
function loadBundle() {
  let captured = null;
  const fakeWindow = {
    __ModuleLoader__: {
      load(spec) {
        captured = spec;
        return spec.id;
      },
    },
  };
  // eslint-disable-next-line no-new-func
  new Function('window', fs.readFileSync(CLIENT, 'utf8'))(fakeWindow);
  return captured;
}

const fakeReact = {
  createElement: (...args) => ({ args }),
  useState: () => [null, () => {}],
  useCallback: (fn) => fn,
  useEffect: () => {},
};

test('client bundle registers under the package name (loader contract)', () => {
  const bundle = loadBundle();
  assert.ok(bundle, 'client.js should call window.__ModuleLoader__.load');
  assert.equal(bundle.id, MANIFEST.name, 'module id must equal the package name');
  assert.equal(typeof bundle.factory, 'function');
});

test('client bundle wires the settings section and both dictionaries', () => {
  const bundle = loadBundle();
  const plugin = bundle.factory(() => fakeReact);
  assert.deepEqual(plugin.inject, ['slots', 'locale']);
  assert.equal(typeof plugin.apply, 'function');

  const locales = [];
  const slots = [];
  const ctx = {
    effect(fn) {
      fn();
    },
    locale: {
      register(...args) {
        locales.push(args);
      },
      bind: (namespace) => (key) => `${namespace}.${key}`,
    },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'settings.section');
        callback();
      },
      register(spec, component) {
        slots.push({ spec, component });
        return () => {};
      },
    },
  };
  plugin.apply(ctx);

  assert.equal(locales.length, 1);
  assert.equal(locales[0][0], 'one-click-launcher');
  assert.ok(locales[0][1].zh && locales[0][1].en, 'zh + en dictionaries expected');

  assert.equal(slots.length, 1);
  const [{ spec, component }] = slots;
  assert.equal(spec.name, 'settings.section');
  assert.equal(spec.id, 'one-click-launcher');
  assert.equal(spec.locale, 'one-click-launcher');
  assert.equal(spec.label(), 'one-click-launcher.nav');
  assert.equal(typeof component, 'function');
  const injected = spec.inject();
  assert.equal(typeof injected.t, 'function');
  assert.equal(injected.t('title'), 'one-click-launcher.title');
});

test('settings component renders without throwing (fake React + fetch)', async () => {
  const bundle = loadBundle();
  let cursor = 0;
  const state = [];
  const fake = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], (value) => { state[index] = value; }];
    },
    useCallback: (fn) => fn,
    useEffect: (fn) => { fn(); },
  };
  const plugin = bundle.factory(() => fake);

  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  console.error = () => {};
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      installed: false,
      platformLabel: 'macOS',
      shortcutPath: '/Users/example/Desktop/DSH Web.app',
      port: 3080,
      profile: 'web',
    }),
  });
  try {
    const slots = [];
    plugin.inject; // keep the shape obvious
    const t = (key) => key;
    const ctx = {
      effect: (fn) => fn(),
      locale: { register() {}, bind: () => t },
      slots: {
        inject: (_name, callback) => callback(),
        register: (spec, component) => {
          slots.push({ spec, component });
          return () => {};
        },
      },
    };
    plugin.apply(ctx);
    const render = (node, depth = 0) => {
      if (node === null || node === undefined || node === false || depth > 32) return [];
      if (Array.isArray(node)) return node.flatMap((child) => render(child, depth + 1));
      if (typeof node === 'string' || typeof node === 'number') return [String(node)];
      if (typeof node.type === 'function') {
        cursor = 0;
        return render(node.type(node.props || {}), depth + 1);
      }
      return render(node.children, depth + 1);
    };
    const texts = render(slots[0].component({ t }));
    assert.ok(texts.includes('title'), 'rendered tree should contain the section title');
    assert.ok(texts.includes('create'));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test('package manifest points at the client bundle and bundle patch', () => {
  assert.equal(MANIFEST.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(MANIFEST.dsh.client.platform, 'web');
  assert.ok(Array.isArray(MANIFEST.dsh.client.inject));
  assert.equal(MANIFEST.exports['./client'], './client.js');
  for (const file of ['index.js', 'client.js', 'lib', 'assets']) {
    assert.ok(MANIFEST.files.includes(file), `${file} must ship`);
  }
});
