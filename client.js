/**
 * DSH one-click launcher — browser half.
 *
 * Registers one Settings section (`settings.section`) that creates, replaces or
 * removes a desktop shortcut for the machine running the host. All the writing
 * happens in the host half through `/plugins/one-click-launcher/*`.
 *
 * Plain JavaScript: React comes from the browser module table and no Harness
 * client package is imported.
 */
window.__ModuleLoader__.load({
  id: 'dsh-one-click-launcher',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'one-click-launcher';
    const BASE = '/plugins/one-click-launcher';

    const DICT_ZH = {
      nav: '桌面快捷方式',
      title: '一键启动快捷方式',
      lead: '在桌面创建双击即可启动 DSH Web 的入口：macOS 生成 .app，Windows 生成 .lnk，Linux 生成 .desktop。启动器会先复用正在运行的实例，否则拉起新的实例并打开带登录凭据的地址。',
      platform: '当前系统',
      location: '位置',
      port: '启动端口',
      profile: '启动 Profile',
      installed: '已创建',
      missing: '未创建',
      create: '创建 / 更新快捷方式',
      remove: '移除',
      creating: '正在创建…',
      removing: '正在移除…',
      created: '已创建：{path}',
      removed: '已移除 {count} 项。',
      failed: '操作失败：{error}',
      hint: '创建后可以把图标拖到 Dock / 任务栏长期使用；重复点击不会启动多个实例。',
      loading: '正在读取状态…',
    };

    const DICT_EN = {
      nav: 'Desktop shortcut',
      title: 'One-click launcher',
      lead: 'Put a double-clickable launcher on your desktop: a .app on macOS, a .lnk on Windows, a .desktop entry on Linux. The launcher reuses a running instance, otherwise starts one and opens its authenticated URL.',
      platform: 'Platform',
      location: 'Location',
      port: 'Port',
      profile: 'Profile',
      installed: 'Created',
      missing: 'Not created',
      create: 'Create / update shortcut',
      remove: 'Remove',
      creating: 'Creating…',
      removing: 'Removing…',
      created: 'Created: {path}',
      removed: 'Removed {count} item(s).',
      failed: 'Failed: {error}',
      hint: 'Drag the icon to the Dock or taskbar for permanent access. Clicking twice never starts two instances.',
      loading: 'Reading status…',
    };

    function format(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
      );
    }

    async function call(method, path) {
      const response = await fetch(BASE + path, {
        method,
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok || !payload || payload.ok !== true) {
        const reason = payload && payload.error ? payload.error : 'HTTP ' + response.status;
        throw new Error(reason);
      }
      return payload;
    }

    const styles = {
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '18px',
        borderRadius: '14px',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.24))',
        background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,.06))',
      },
      title: {
        fontSize: '15px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary, inherit)',
        margin: 0,
      },
      lead: {
        fontSize: '13px',
        lineHeight: 1.65,
        color: 'var(--dsw-alias-label-secondary, inherit)',
        margin: 0,
      },
      rows: { display: 'flex', flexDirection: 'column', gap: '6px' },
      row: { display: 'flex', gap: '10px', fontSize: '12.5px', lineHeight: 1.5 },
      key: {
        flex: '0 0 92px',
        color: 'var(--dsw-alias-label-tertiary, inherit)',
      },
      value: {
        flex: '1 1 auto',
        minWidth: 0,
        wordBreak: 'break-all',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        color: 'var(--dsw-alias-label-primary, inherit)',
      },
      actions: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' },
      primary: {
        appearance: 'none',
        border: '1px solid transparent',
        borderRadius: '10px',
        padding: '8px 14px',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-on-brand, #fff)',
        background: 'var(--dsw-alias-brand-primary, #2f6fed)',
      },
      secondary: {
        appearance: 'none',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.32))',
        borderRadius: '10px',
        padding: '8px 14px',
        fontSize: '13px',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary, inherit)',
        background: 'transparent',
      },
      badge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '12px',
        padding: '3px 9px',
        borderRadius: '999px',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.3))',
      },
      message: {
        fontSize: '12.5px',
        lineHeight: 1.6,
        padding: '9px 12px',
        borderRadius: '10px',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.3))',
        background: 'var(--dsw-alias-bg-overlay, rgba(128,128,128,.08))',
        wordBreak: 'break-all',
      },
      hint: {
        fontSize: '12px',
        lineHeight: 1.6,
        color: 'var(--dsw-alias-label-tertiary, inherit)',
        margin: 0,
      },
    };

    function InfoRow({ label, value }) {
      return h(
        'div',
        { style: styles.row },
        h('span', { style: styles.key }, label),
        h('span', { style: styles.value }, value),
      );
    }

    function Section(props) {
      const t = props.t;
      const [status, setStatus] = React.useState(null);
      const [busy, setBusy] = React.useState(null);
      const [message, setMessage] = React.useState(null);

      const load = React.useCallback(async () => {
        try {
          const payload = await call('GET', '/status');
          setStatus(payload);
        } catch (error) {
          setMessage({ kind: 'error', text: format(t('failed'), { error: error.message }) });
        }
      }, [t]);

      React.useEffect(() => {
        load();
      }, [load]);

      const run = async (action) => {
        setBusy(action);
        setMessage(null);
        try {
          const payload = await call('POST', '/' + action);
          setStatus(payload);
          if (action === 'create') {
            setMessage({ kind: 'ok', text: format(t('created'), { path: payload.created ? payload.created.path : payload.shortcutPath }) });
          } else {
            setMessage({ kind: 'ok', text: format(t('removed'), { count: (payload.removed || []).length }) });
          }
        } catch (error) {
          setMessage({ kind: 'error', text: format(t('failed'), { error: error.message }) });
        } finally {
          setBusy(null);
        }
      };

      const installed = status ? status.installed : false;
      const badgeLabel = status ? (installed ? t('installed') : t('missing')) : t('loading');

      return h(
        'div',
        { style: styles.card },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
          h('h3', { style: styles.title }, t('title')),
          h(
            'span',
            {
              style: Object.assign({}, styles.badge, {
                color: installed
                  ? 'var(--dsw-alias-state-success-primary, #1a9e63)'
                  : 'var(--dsw-alias-label-tertiary, inherit)',
              }),
            },
            installed ? '● ' : '○ ',
            badgeLabel,
          ),
        ),
        h('p', { style: styles.lead }, t('lead')),
        status
          ? h(
              'div',
              { style: styles.rows },
              h(InfoRow, { label: t('platform'), value: status.platformLabel }),
              h(InfoRow, { label: t('location'), value: status.shortcutPath }),
              h(InfoRow, { label: t('port'), value: String(status.port) }),
              h(InfoRow, { label: t('profile'), value: status.profile || 'web' }),
            )
          : h('p', { style: styles.hint }, t('loading')),
        h(
          'div',
          { style: styles.actions },
          h(
            'button',
            {
              type: 'button',
              style: Object.assign({}, styles.primary, busy ? { opacity: 0.6, cursor: 'default' } : null),
              disabled: Boolean(busy),
              onClick: () => run('create'),
            },
            busy === 'create' ? t('creating') : t('create'),
          ),
          installed
            ? h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, styles.secondary, busy ? { opacity: 0.6, cursor: 'default' } : null),
                  disabled: Boolean(busy),
                  onClick: () => run('remove'),
                },
                busy === 'remove' ? t('removing') : t('remove'),
              )
            : null,
        ),
        message
          ? h(
              'div',
              {
                style: Object.assign({}, styles.message, {
                  color:
                    message.kind === 'error'
                      ? 'var(--dsw-alias-state-error-primary, #d33)'
                      : 'var(--dsw-alias-state-success-primary, #1a9e63)',
                }),
              },
              message.text,
            )
          : null,
        h('p', { style: styles.hint }, t('hint')),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN }));
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: NS,
              order: 60,
              label: () => t('nav'),
              locale: NS,
              inject: () => ({ t }),
            },
            () => h(Section, { t }),
          ),
        );
      },
    };
  },
});
