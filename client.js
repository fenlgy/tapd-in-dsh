/**
 * tapd-in-dsh 的浏览器半区。
 *
 * 贡献两样东西：
 *   - 左侧面板列表里的「TAPD」入口（`sidebar.panellist`）；
 *   - 它选中后显示的页面（`main`，key 与入口 id 一致）。
 *
 * 所有请求都打到宿主半区在本机注册的 `/tapd` 前缀：
 *   GET  /tapd/__config   PUT /tapd/__config   POST /tapd/__test
 *   GET  /tapd/__stories  GET /tapd/__story?id=
 * 因此凭据只留在 Node 侧，浏览器不做跨域请求。
 *
 * 这个文件是手写的、不需要构建：DSH 的客户端加载器按
 * `window.__ModuleLoader__.load({ id, factory })` 的约定取模块，
 * `require` 只解析宿主已提供的裸模块（react）。
 */
window.__ModuleLoader__.load({
  id: 'tapd-in-dsh',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    /** locale 命名空间。 */
    const NS = 'tapd-in-dsh';
    /** 侧栏入口 id；同时也是 `main` 插槽的 key。 */
    const PANEL_ID = 'tapd';
    /** 宿主半区注册的前缀路由。 */
    const ROUTE_PATH = '/tapd';
    /** 各端点相对前缀的路径。 */
    const CONFIG_PATH = '/__config';
    const TEST_PATH = '/__test';
    const STORIES_PATH = '/__stories';
    const STORY_PATH = '/__story';
    /** 一次拉多少条需求。 */
    const PAGE_LIMIT = 30;

    //#region transport

    /**
     * 宿主前缀的绝对地址。和 DSH 自己的客户端代码取法一致：
     * 优先用注入的 transport，其次 document.baseURI。
     * @returns 去掉尾斜杠的前缀地址
     */
    function routeBase() {
      const transport = globalThis.__DSH_TRANSPORT__;
      const anchor =
        (transport && typeof transport.streamBaseUrl === 'string' && transport.streamBaseUrl) ||
        (typeof document !== 'undefined' && document.baseURI) ||
        (typeof location !== 'undefined' && location.href) ||
        'http://127.0.0.1/';
      try {
        return new URL(ROUTE_PATH, anchor).href.replace(/\/$/, '');
      } catch {
        return ROUTE_PATH;
      }
    }

    /**
     * 读一次 JSON 响应，失败时把服务端的 error 文案带出来。
     * @param response fetch 的响应
     * @param context 用于拼错误信息的方法与路径
     * @returns 解析后的载荷
     */
    async function readReply(response, context) {
      const raw = await response.text();
      let payload = null;
      if (raw !== '') {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = raw;
        }
      }
      if (!response.ok) {
        throw new Error(errorMessage(payload, response.status, context));
      }
      return payload;
    }

    /**
     * 把服务端载荷整理成一句人话。
     * @param payload 响应体
     * @param status HTTP 状态
     * @param context 方法与路径
     * @returns 错误文案
     */
    function errorMessage(payload, status, context) {
      const detail =
        payload && typeof payload === 'object' && typeof payload.error === 'string'
          ? payload.error
          : typeof payload === 'string' && payload.trim() !== ''
            ? payload.trim().slice(0, 200)
            : '';
      const where = `${context.method} ${context.path}`;
      if (status === 404) return `接口没挂上（${where}）：插件可能没加载完，重开一次面板试试。`;
      if (status === 502 && detail) return detail;
      if (detail) return detail;
      return `${where} 返回 HTTP ${status}`;
    }

    /** 读有效配置（密钥只有存在性标记）。 */
    async function loadConfig() {
      const response = await fetch(`${routeBase()}${CONFIG_PATH}`, { headers: { accept: 'application/json' } });
      const payload = await readReply(response, { method: 'GET', path: CONFIG_PATH });
      return (payload && payload.config) || {};
    }

    /**
     * 保存配置补丁。字段传空字符串即清空。
     * @param patch 要写入的字段
     */
    async function saveConfig(patch) {
      const response = await fetch(`${routeBase()}${CONFIG_PATH}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(patch),
      });
      const payload = await readReply(response, { method: 'PUT', path: CONFIG_PATH });
      return (payload && payload.config) || {};
    }

    /** 用当前配置真打一次 TAPD。 */
    async function testConnection() {
      const response = await fetch(`${routeBase()}${TEST_PATH}`, {
        method: 'POST',
        headers: { accept: 'application/json' },
      });
      const payload = await readReply(response, { method: 'POST', path: TEST_PATH });
      return payload || { ok: false, error: '没有响应内容' };
    }

    /**
     * 查需求列表。
     * @param params 关键词 / 状态 / 条数
     */
    async function loadStories(params) {
      const query = new URLSearchParams();
      if (params && params.keyword) query.set('keyword', params.keyword);
      if (params && params.status) query.set('status', params.status);
      query.set('limit', String((params && params.limit) || PAGE_LIMIT));
      const path = `${STORIES_PATH}?${query.toString()}`;
      const response = await fetch(`${routeBase()}${path}`, { headers: { accept: 'application/json' } });
      const payload = await readReply(response, { method: 'GET', path: STORIES_PATH });
      return payload || { configured: false, stories: [] };
    }

    /**
     * 读单条需求全文。
     * @param id 需求 ID
     */
    async function loadStory(id) {
      const path = `${STORY_PATH}?id=${encodeURIComponent(id)}`;
      const response = await fetch(`${routeBase()}${path}`, { headers: { accept: 'application/json' } });
      const payload = await readReply(response, { method: 'GET', path: STORY_PATH });
      if (payload && payload.error) throw new Error(String(payload.error));
      return (payload && payload.story) || null;
    }

    //#endregion
    //#region 视觉常量

    /** 面板统一的留白。 */
    const PAD = 16;
    /** 行与行之间的细线。 */
    const HAIRLINE = '0.5px solid var(--dsw-alias-border-l1)';
    /** 次要文字。 */
    const MUTED = 'var(--dsw-alias-label-tertiary)';
    /** 主文字。 */
    const INK = 'var(--dsw-alias-label-primary)';

    /** 状态 → 颜色，尽量贴合 TAPD 的习惯。 */
    const STATUS_TONE = {
      planning: '#7c8b9a',
      developing: '#2f7de1',
      testing: '#c47f00',
      done: '#1f9254',
      rejected: '#c0392b',
    };

    //#endregion
    //#region 组件

    /**
     * 侧栏图标：一个带勾的清单。
     * @param props.size 图标边长
     */
    function PanelIcon({ size }) {
      const dimension = typeof size === 'number' ? size : 16;
      return h(
        'svg',
        {
          width: dimension,
          height: dimension,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        h('rect', { x: 2.4, y: 1.6, width: 11.2, height: 12.8, rx: 2 }),
        h('path', { d: 'M5.2 5.6h5.6M5.2 8h5.6M5.2 10.4h3.2' }),
      );
    }

    /**
     * 一行表单字段。
     * @param props 标签、提示、输入属性
     */
    function Field(props) {
      const { label, hint, secret, ...inputProps } = props;
      return h(
        'label',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('span', { style: { fontSize: 12, color: MUTED } }, label),
        h('input', {
          ...inputProps,
          type: secret ? 'password' : 'text',
          autoComplete: 'off',
          spellCheck: false,
          style: {
            height: 30,
            padding: '0 8px',
            fontSize: 13,
            color: INK,
            background: 'var(--dsw-alias-fill-l1)',
            border: HAIRLINE,
            borderRadius: 'var(--dsw-radius-md)',
            outline: 'none',
          },
        }),
        hint ? h('span', { style: { fontSize: 11, color: MUTED, lineHeight: '16px' } }, hint) : null,
      );
    }

    /**
     * 主按钮 / 次按钮。
     * @param props.variant primary | ghost
     */
    function Button({ children, variant, busy, ...rest }) {
      const primary = variant === 'primary';
      return h(
        'button',
        {
          ...rest,
          type: 'button',
          disabled: rest.disabled || busy,
          style: {
            height: 30,
            padding: '0 12px',
            fontSize: 12,
            cursor: rest.disabled || busy ? 'default' : 'pointer',
            opacity: rest.disabled || busy ? 0.55 : 1,
            borderRadius: 'var(--dsw-radius-md)',
            color: primary ? '#fff' : INK,
            background: primary ? 'var(--dsw-alias-brand-primary, #2f7de1)' : 'transparent',
            border: primary ? 'none' : HAIRLINE,
          },
        },
        busy ? '···' : children,
      );
    }

    /** 顶部提示条。 */
    function Note({ note }) {
      if (!note) return null;
      const error = note.kind === 'error';
      return h(
        'div',
        {
          style: {
            margin: `0 ${PAD}px 8px`,
            padding: '7px 10px',
            fontSize: 12,
            lineHeight: '18px',
            borderRadius: 'var(--dsw-radius-md)',
            color: error ? 'var(--dsw-alias-state-error-primary, #c0392b)' : 'var(--dsw-alias-label-secondary)',
            background: error ? 'rgba(192,57,43,0.08)' : 'var(--dsw-alias-fill-l1)',
            border: HAIRLINE,
          },
        },
        note.text,
      );
    }

    /**
     * 配置表单。首次进入、或点「设置」时显示。
     * @param props 当前配置、保存/测试回调
     */
    function SettingsCard({ config, onSaved, onTest, busy }) {
      const [form, setForm] = useState(() => ({
        workspaceId: config.workspaceId || '',
        apiToken: '',
        apiUser: config.apiUser || '',
        apiPassword: '',
        baseUrl: config.baseUrl || 'https://api.tapd.cn',
      }));
      const [testing, setTesting] = useState(false);
      const [result, setResult] = useState(null);

      const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

      const submit = async () => {
        setResult(null);
        const patch = {
          workspaceId: form.workspaceId.trim(),
          apiUser: form.apiUser.trim(),
          baseUrl: form.baseUrl.trim(),
        };
        // 空着不提交：留空表示「不修改」，清空要显式点「清除令牌」之类的动作才有意义。
        if (form.apiToken.trim() !== '') patch.apiToken = form.apiToken.trim();
        if (form.apiPassword.trim() !== '') patch.apiPassword = form.apiPassword.trim();
        await onSaved(patch);
        setForm((prev) => ({ ...prev, apiToken: '', apiPassword: '' }));
      };

      const probe = async () => {
        setTesting(true);
        setResult(null);
        try {
          const payload = await onTest();
          setResult(payload);
        } finally {
          setTesting(false);
        }
      };

      return h(
        'div',
        {
          style: {
            margin: PAD,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            background: 'var(--dsw-alias-fill-l1)',
            border: HAIRLINE,
            borderRadius: 'var(--dsw-radius-lg, 10px)',
          },
        },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
          h('strong', { style: { fontSize: 13, color: INK } }, '连接 TAPD'),
          h(
            'span',
            { style: { fontSize: 11, color: MUTED, lineHeight: '16px' } },
            '填一次就存在本机，宿主侧工具和这个面板共用同一份配置。',
          ),
        ),
        h(Field, {
          label: '项目 ID',
          placeholder: '如 10104801',
          value: form.workspaceId,
          onChange: set('workspaceId'),
          hint: 'TAPD 项目地址里 /tapd_fe/<项目ID>/ 那一段；单项目用只填这里就够。',
        }),
        h(Field, {
          label: config.hasToken ? '个人访问令牌（已保存，留空不修改）' : '个人访问令牌',
          placeholder: config.hasToken ? '••••••••' : 'TAPD 个人设置 → 个人访问令牌',
          secret: true,
          value: form.apiToken,
          onChange: set('apiToken'),
          hint: '最省事的方式：Bearer 鉴权，只读需求也能用。',
        }),
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'flex-end' } },
          h('div', { style: { flex: 1 } }, h(Field, {
            label: config.hasBasic ? '开放应用 ID（已保存）' : '开放应用 ID',
            placeholder: '团队分发时用',
            value: form.apiUser,
            onChange: set('apiUser'),
          })),
          h('div', { style: { flex: 1 } }, h(Field, {
            label: config.hasBasic ? '应用秘钥（已保存，留空不修改）' : '应用秘钥',
            placeholder: '与应用 ID 配套',
            secret: true,
            value: form.apiPassword,
            onChange: set('apiPassword'),
          })),
        ),
        h(Field, {
          label: '接口地址',
          value: form.baseUrl,
          onChange: set('baseUrl'),
          hint: '私有化部署才需要改，默认 https://api.tapd.cn',
        }),
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h(Button, { variant: 'primary', onClick: submit, busy }, '保存'),
          h(Button, { onClick: probe, busy: testing }, '测试连接'),
          result
            ? h(
                'span',
                {
                  style: {
                    fontSize: 11,
                    color: result.ok ? '#1f9254' : 'var(--dsw-alias-state-error-primary, #c0392b)',
                  },
                },
                result.ok
                  ? `连上了（项目 ${result.workspaceId}）${result.sample ? `：${result.sample}` : ''}`
                  : String(result.error || '连不上'),
              )
            : null,
        ),
      );
    }

    /**
     * 列表里的一行需求。
     * @param props 需求摘要与选中回调
     */
    function StoryRow({ story, onOpen }) {
      const tone = STATUS_TONE[story.status] || MUTED;
      return h(
        'button',
        {
          type: 'button',
          onClick: () => onOpen(story),
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            width: '100%',
            textAlign: 'left',
            padding: '9px 10px',
            background: 'transparent',
            border: 'none',
            borderTop: HAIRLINE,
            cursor: 'pointer',
            color: INK,
          },
          onMouseEnter: (event) => {
            event.currentTarget.style.background = 'var(--dsw-alias-fill-l1)';
          },
          onMouseLeave: (event) => {
            event.currentTarget.style.background = 'transparent';
          },
        },
        h(
          'span',
          { style: { fontSize: 13, lineHeight: '19px', overflow: 'hidden', textOverflow: 'ellipsis' } },
          story.name || '(无标题)',
        ),
        h(
          'span',
          { style: { display: 'flex', gap: 8, fontSize: 11, color: MUTED, alignItems: 'center' } },
          h('span', { style: { color: tone } }, `● ${story.status || '未设置'}`),
          story.owner ? h('span', null, story.owner) : null,
          story.priority_label ? h('span', null, story.priority_label) : null,
          h('span', { style: { marginLeft: 'auto' } }, `#${story.id}`),
        ),
        story.summary
          ? h(
              'span',
              {
                style: {
                  fontSize: 11,
                  lineHeight: '16px',
                  color: MUTED,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                },
              },
              story.summary,
            )
          : null,
      );
    }

    /**
     * 单条需求详情。
     * @param props 需求、返回与复制回调
     */
    function StoryDetail({ story, loading, error, onBack, onCopy, t }) {
      if (loading) return h('div', { style: { padding: PAD, fontSize: 12, color: MUTED } }, t('loading'));
      if (error) return h('div', { style: { padding: PAD, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, error);
      if (!story) return null;
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: `10px ${PAD}px`,
              borderBottom: HAIRLINE,
            },
          },
          h(Button, { onClick: onBack }, t('back')),
          h('span', { style: { fontSize: 11, color: MUTED } }, `#${story.id}`),
          h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 8 } },
            h(Button, { onClick: () => onCopy(`@tapd:story:${story.id}`) }, t('copyRef')),
            h(Button, { onClick: () => onCopy(story.id) }, t('copyId')),
          ),
        ),
        h(
          'div',
          { style: { padding: PAD, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 } },
          h('h2', { style: { margin: 0, fontSize: 15, lineHeight: '22px', color: INK } }, story.name || '(无标题)'),
          h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: MUTED } },
            h('span', null, `${t('status')}: ${story.status || '未设置'}`),
            h('span', null, `${t('owner')}: ${story.owner || '未指派'}`),
            h('span', null, `${t('priority')}: ${story.priority_label || '未设置'}`),
            h('span', null, `${t('modified')}: ${story.modified || '-'}`),
          ),
          story.description
            ? h(
                'pre',
                {
                  style: {
                    margin: 0,
                    padding: 10,
                    fontSize: 12,
                    lineHeight: '19px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: INK,
                    background: 'var(--dsw-alias-fill-l1)',
                    border: HAIRLINE,
                    borderRadius: 'var(--dsw-radius-md)',
                    fontFamily: 'inherit',
                  },
                },
                story.description,
              )
            : h('span', { style: { fontSize: 12, color: MUTED } }, t('noDescription')),
          h(
            'a',
            {
              href: story.url,
              target: '_blank',
              rel: 'noreferrer',
              style: { fontSize: 12, color: 'var(--dsw-alias-brand-primary, #2f7de1)' },
            },
            t('openInTapd'),
          ),
        ),
      );
    }

    /**
     * 面板主体。
     * @param props 插槽属性（含 t）与环境
     */
    function TapdPage(props) {
      const t = props.t || ((key) => key);
      const [config, setConfig] = useState(null);
      const [showSettings, setShowSettings] = useState(false);
      const [stories, setStories] = useState([]);
      const [keyword, setKeyword] = useState('');
      const [busy, setBusy] = useState(false);
      const [note, setNote] = useState(null);
      const [detail, setDetail] = useState(null);
      const [detailLoading, setDetailLoading] = useState(false);
      const [detailError, setDetailError] = useState(null);
      const firstLoad = useRef(true);

      const fail = useCallback((error) => setNote({ kind: 'error', text: String((error && error.message) || error) }), []);

      const refresh = useCallback(
        async (nextKeyword) => {
          setBusy(true);
          setNote(null);
          try {
            const payload = await loadStories({ keyword: nextKeyword === undefined ? keyword : nextKeyword, limit: PAGE_LIMIT });
            setStories(Array.isArray(payload.stories) ? payload.stories : []);
            if (payload.configured === false) {
              setShowSettings(true);
              setNote({ kind: 'error', text: t('needConfig') });
            }
          } catch (error) {
            setStories([]);
            fail(error);
          } finally {
            setBusy(false);
          }
        },
        [fail, keyword, t],
      );

      // 首次进入：读配置；没配好就直接把人送到配置表单前。
      useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const view = await loadConfig();
            if (!alive) return;
            setConfig(view);
            if (!view.configured) {
              setShowSettings(true);
              setNote({ kind: 'error', text: t('needConfig') });
              return;
            }
            await refresh('');
          } catch (error) {
            if (alive) fail(error);
          } finally {
            firstLoad.current = false;
          }
        })();
        return () => {
          alive = false;
        };
        // 只在挂载时跑一次
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      const save = useCallback(
        async (patch) => {
          setBusy(true);
          setNote(null);
          try {
            const view = await saveConfig(patch);
            setConfig(view);
            setShowSettings(false);
            setNote({ kind: 'ok', text: t('saved') });
            await refresh('');
          } catch (error) {
            fail(error);
          } finally {
            setBusy(false);
          }
        },
        [fail, refresh, t],
      );

      const openStory = useCallback(
        async (row) => {
          setDetail({ summary: row });
          setDetailError(null);
          setDetailLoading(true);
          try {
            const story = await loadStory(row.id);
            setDetail(story);
          } catch (error) {
            setDetailError(String((error && error.message) || error));
          } finally {
            setDetailLoading(false);
          }
        },
        [],
      );

      const copy = useCallback(
        async (text) => {
          try {
            await globalThis.navigator.clipboard.writeText(text);
            setNote({ kind: 'ok', text: `${t('copied')} ${text}` });
          } catch {
            setNote({ kind: 'error', text: `${t('copyFailed')} ${text}` });
          }
        },
        [t],
      );

      const subtitle = useMemo(() => {
        if (!config) return t('subtitle');
        if (!config.configured) return t('notConfigured');
        const parts = [];
        if (config.workspaceId) parts.push(`#${config.workspaceId}`);
        parts.push(config.hasBasic ? t('authBasic') : t('authToken'));
        return parts.join(' · ');
      }, [config, t]);

      const header = h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: `12px ${PAD}px 10px`,
            borderBottom: HAIRLINE,
          },
        },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 } },
          h('strong', { style: { fontSize: 13, color: INK } }, t('panel')),
          h('span', { style: { fontSize: 11, color: MUTED } }, subtitle),
        ),
        h(
          'div',
          { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
          h(Button, { onClick: () => refresh(), busy }, t('refresh')),
          h(Button, { onClick: () => setShowSettings((prev) => !prev) }, showSettings ? t('close') : t('settings')),
        ),
      );

      let body;
      if (detail) {
        body = h(StoryDetail, {
          story: detail,
          loading: detailLoading,
          error: detailError,
          onBack: () => setDetail(null),
          onCopy: copy,
          t,
        });
      } else if (showSettings || !config || !config.configured) {
        body = h(SettingsCard, {
          config: config || {},
          onSaved: save,
          onTest: testConnection,
          busy,
        });
      } else {
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
          h(
            'div',
            { style: { display: 'flex', gap: 6, padding: `10px ${PAD}px` } },
            h('input', {
              value: keyword,
              placeholder: t('searchPlaceholder'),
              onChange: (event) => setKeyword(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') refresh(event.currentTarget.value);
              },
              style: {
                flex: 1,
                height: 30,
                padding: '0 8px',
                fontSize: 12,
                color: INK,
                background: 'var(--dsw-alias-fill-l1)',
                border: HAIRLINE,
                borderRadius: 'var(--dsw-radius-md)',
                outline: 'none',
              },
            }),
          ),
          stories.length === 0
            ? h(
                'div',
                { style: { padding: PAD, fontSize: 12, color: MUTED } },
                busy ? t('loading') : t('empty'),
              )
            : h(
                'div',
                { style: { overflow: 'auto', flex: 1 } },
                stories.map((story) => h(StoryRow, { key: story.id, story, onOpen: openStory })),
              ),
        );
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: INK } },
        header,
        h(Note, { note }),
        body,
      );
    }

    //#endregion

    /** 需要客户端服务：插槽注册表 + 词典。 */
    const inject = ['slots', 'locale'];

    /**
     * 客户端插件入口。
     * @param ctx 客户端根 context
     */
    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh: {
              panel: 'TAPD',
              subtitle: 'TAPD 需求',
              notConfigured: '还没配置',
              needConfig: '先填项目 ID 和访问令牌，保存后就能看到需求列表了。',
              refresh: '刷新',
              settings: '设置',
              close: '收起',
              save: '保存',
              saved: '已保存',
              loading: '读取中…',
              empty: '这个项目下没查到需求。',
              searchPlaceholder: '按标题搜索，回车执行',
              back: '返回',
              copyRef: '复制引用',
              copyId: '复制 ID',
              copied: '已复制',
              copyFailed: '复制失败，请手动复制：',
              status: '状态',
              owner: '处理人',
              priority: '优先级',
              modified: '更新',
              noDescription: '这条需求没有描述正文。',
              openInTapd: '在 TAPD 打开',
              authBasic: '开放应用鉴权',
              authToken: '个人令牌',
            },
            en: {
              panel: 'TAPD',
              subtitle: 'TAPD stories',
              notConfigured: 'Not configured',
              needConfig: 'Fill in the project ID and an access token, then save to load stories.',
              refresh: 'Refresh',
              settings: 'Settings',
              close: 'Close',
              save: 'Save',
              saved: 'Saved',
              loading: 'Loading…',
              empty: 'No stories found in this project.',
              searchPlaceholder: 'Search by title, press Enter',
              back: 'Back',
              copyRef: 'Copy reference',
              copyId: 'Copy ID',
              copied: 'Copied',
              copyFailed: 'Copy failed, copy manually:',
              status: 'Status',
              owner: 'Owner',
              priority: 'Priority',
              modified: 'Updated',
              noDescription: 'This story has no description.',
              openInTapd: 'Open in TAPD',
              authBasic: 'app credentials',
              authToken: 'personal token',
            },
          }),
        'tapd-in-dsh: dictionaries',
      );

      const bound = ctx.locale.bind(NS);
      /** 词典取值，缺 key 时退回 key 本身。 */
      const text = (key, params) => {
        const raw = bound(key);
        const template = typeof raw === 'string' && raw !== '' ? raw : key;
        if (params === undefined) return template;
        return template.replace(/\{(\w+)\}/g, (match, name) =>
          Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
        );
      };

      // 页面必须比侧栏入口先注册：入口不会选中一个 `main` 解析不到的 key。
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, (slotProps) =>
          h(TapdPage, { ...slotProps, t: (key, params) => text(key, params) }),
        ),
      );

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 12,
            label: () => text('panel'),
            locale: NS,
          },
          PanelIcon,
        ),
      );
    }

    return { name: 'tapd-in-dsh', inject, apply };
  },
});
