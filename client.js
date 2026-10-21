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
 *
 * 视觉上刻意贴着宿主自己的设计系统走，不自己发明一套：
 *   - 颜色 / 圆角 / 字号全部用宿主的 `--dsw-*` 设计令牌（跟随明暗主题）；
 *   - 页面骨架照抄宿主设置页的量法：内容列 960px、标题 20/28 500、
 *     说明 13/20 secondary、卡片圆角 `--dsw-radius-xl`、行高 14/22；
 *   - 按钮尺寸与宿主一致：md 36px、sm 28px，圆角 `--dsw-radius-md`；
 *   - 桌面端顶部让开窗口按钮：`--dsh-frame-top-clearance`。
 */
window.__ModuleLoader__.load({
  id: 'tapd-in-dsh',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useState } = React;

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
     * 面板请求的前缀地址，必须与页面**同源**。
     *
     * 桌面端的页面跑在 `dsh-app://app`，由主进程把这个源上的请求带上宿主 cookie
     * 转发给真正的 host；Web 端的页面本身就在宿主源上。因此这里优先用页面自己的
     * origin，而不是 `transport.streamBaseUrl`（形如 http://127.0.0.1:端口）：
     * 那是宿主监听地址，直接打过去属于跨源请求，宿主侧既没有 CORS 头也没有会话
     * cookie，浏览器会整个拦掉，面板上表现为「保存不了 / 测试连接没反应」。
     * @returns 去掉尾斜杠的前缀地址
     */
    function routeBase() {
      const transport = globalThis.__DSH_TRANSPORT__;
      const streamBase =
        transport && typeof transport.streamBaseUrl === 'string' ? transport.streamBaseUrl : '';
      const anchors = [];
      if (typeof document !== 'undefined' && document.baseURI) anchors.push(document.baseURI);
      if (typeof location !== 'undefined' && location.href) anchors.push(location.href);
      if (streamBase) anchors.push(streamBase);
      for (const anchor of anchors) {
        try {
          const url = new URL(ROUTE_PATH, anchor);
          // file:// 页面 fetch 不出去，换下一个候选
          if (url.protocol === 'file:') continue;
          return url.href.replace(/\/$/, '');
        } catch {
          /* 换下一个候选 */
        }
      }
      return ROUTE_PATH;
    }

    /**
     * 发一次请求并读出 JSON。
     *
     * 把「请求根本没发到宿主」和「宿主回了错误」分开报，否则面板只会显示
     * 一句 Failed to fetch，看不出是配置问题还是链路问题。
     * @param path 相对前缀的路径（含查询串）
     * @param init fetch 的初始化参数
     * @param context 用于拼错误信息的方法与路径
     * @returns 解析后的载荷
     */
    async function send(path, init, context) {
      const url = `${routeBase()}${path}`;
      let response;
      try {
        response = await fetch(url, init);
      } catch (error) {
        const detail = String((error && error.message) || error);
        throw new Error(
          `请求没发到宿主（${context.method} ${context.path}）：${detail}。`
            + `面板走的是同源地址 ${url}，如果这里不是 DSH 的界面请重开面板。`,
        );
      }
      return readReply(response, context);
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
      const payload = await send(CONFIG_PATH, { headers: { accept: 'application/json' } }, {
        method: 'GET',
        path: CONFIG_PATH,
      });
      return (payload && payload.config) || {};
    }

    /**
     * 保存配置补丁。字段传空字符串即清空。
     * @param patch 要写入的字段
     */
    async function saveConfig(patch) {
      const payload = await send(
        CONFIG_PATH,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(patch),
        },
        { method: 'PUT', path: CONFIG_PATH },
      );
      return (payload && payload.config) || {};
    }

    /**
     * 用当前配置真打一次 TAPD。
     * @param patch 面板上尚未保存的值；带上就按屏幕上的值探活，不用先保存
     */
    async function testConnection(patch) {
      const payload = await send(
        TEST_PATH,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(patch || {}),
        },
        { method: 'POST', path: TEST_PATH },
      );
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
      const payload = await send(path, { headers: { accept: 'application/json' } }, {
        method: 'GET',
        path: STORIES_PATH,
      });
      return payload || { configured: false, stories: [] };
    }

    /**
     * 读单条需求全文。
     * @param id 需求 ID
     */
    async function loadStory(id) {
      const path = `${STORY_PATH}?id=${encodeURIComponent(id)}`;
      const payload = await send(path, { headers: { accept: 'application/json' } }, {
        method: 'GET',
        path: STORY_PATH,
      });
      if (payload && payload.error) throw new Error(String(payload.error));
      return (payload && payload.story) || null;
    }

    //#endregion
    //#region 样式

    /**
     * 面板样式表。
     *
     * 全部基于宿主的 `--dsw-*` 令牌，宿主换明暗主题时这里自动跟着变；
     * 尺寸与排版照宿主设置页 / 插件页的量法，避免「一眼看上去是外挂」。
     * 类名统一 `tapd-` 前缀，卸载时整块移除，不污染宿主样式。
     */
    const STYLE_CSS = `
.tapd-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:14px;line-height:22px;-webkit-font-smoothing:antialiased}

/* 顶栏：与宿主页面同一套留白，桌面端让开窗口按钮 */
.tapd-bar{flex:none;padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.tapd-barInner,.tapd-bodyInner{max-width:960px;margin:0 auto;padding-left:clamp(24px,4vw,48px);padding-right:clamp(24px,4vw,48px);box-sizing:border-box}
.tapd-barInner{padding-bottom:14px;display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap}
.tapd-heading{min-width:0;flex:1}
.tapd-title{margin:0;font-size:20px;font-weight:500;line-height:28px;letter-spacing:-0.01em}
.tapd-intro{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.tapd-dot{width:3px;height:3px;border-radius:50%;background:var(--dsw-alias-label-dimmed);flex:none}
.tapd-toolbar{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tapd-crumbRow{display:flex;align-items:center;gap:10px;width:100%;flex-wrap:wrap;min-width:0}
.tapd-crumb{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.tapd-crumbCurrent{font-weight:500;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}

.tapd-body{flex:1;min-height:0;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent}
.tapd-bodyInner{padding-bottom:48px;display:flex;flex-direction:column;gap:16px}
.tapd-stack{display:flex;flex-direction:column;gap:20px}
.tapd-sectionHead{display:flex;align-items:baseline;gap:10px;padding-top:4px}
.tapd-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.tapd-mono{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-variant-numeric:tabular-nums}

/* 按钮：尺寸与宿主一致（md 36 / sm 28） */
.tapd-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer;white-space:nowrap;text-decoration:none;transition:background .12s ease,color .12s ease,opacity .12s ease}
.tapd-btn[data-size=sm]{height:28px;padding:0 10px;font-size:12px;line-height:18px;gap:4px;border-radius:var(--dsw-radius-sm)}
.tapd-btn:disabled{cursor:not-allowed;opacity:.4}
.tapd-btn[data-variant=primary]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.tapd-btn[data-variant=primary]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.tapd-btn[data-variant=outline]{border:.5px solid var(--dsw-alias-border-l3)}
.tapd-btn[data-variant=outline]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.tapd-btn[data-variant=ghost]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.tapd-btn[data-variant=ghost]:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.tapd-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.tapd-btnIcon{display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center;flex:none}

/* 表单：左侧标签说明、右侧控件，和宿主设置页同一套排法 */
.tapd-field{display:flex;align-items:flex-start;gap:24px;min-width:0}
.tapd-fieldText{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;padding-top:5px}
.tapd-fieldControl{flex:none;width:320px;min-width:0;display:flex;flex-direction:column;gap:6px}
.tapd-fieldLabel{display:flex;align-items:center;gap:8px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
.tapd-fieldDesc{font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.tapd-input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;outline:none;transition:border-color .12s ease}
.tapd-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.tapd-input:focus{border-color:var(--dsw-alias-state-business-primary)}
.tapd-row2{display:flex;flex-direction:column;gap:16px}

/* 搜索框 */
.tapd-search{display:flex;align-items:center;gap:6px;height:32px;width:220px;max-width:100%;padding:0 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);transition:border-color .12s ease}
.tapd-search:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.tapd-searchIcon{display:inline-flex;color:var(--dsw-alias-label-tertiary);flex:none}
.tapd-searchInput{flex:1;min-width:0;border:0;outline:none;background:transparent;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.tapd-searchInput::placeholder{color:var(--dsw-alias-label-dimmed)}
.tapd-searchClear{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:none}
.tapd-searchClear:hover{color:var(--dsw-alias-label-primary)}

/* 标签 */
.tapd-tag{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:999px;font-size:12px;line-height:18px;white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.tapd-tag[data-tone=success]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}
.tapd-tag[data-tone=info]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary)}
.tapd-tag[data-tone=warning]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-label)}
.tapd-tag[data-tone=danger]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.tapd-tag[data-tone=outline]{background:transparent;border:.5px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-tertiary)}

/* 卡片 */
.tapd-card{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.tapd-cardHead{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.tapd-cardTitle{margin:0;font-size:14px;font-weight:500;line-height:22px}
.tapd-cardBody{padding:16px;display:flex;flex-direction:column;gap:16px}
.tapd-cardFoot{display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap}

/* 列表 */
.tapd-row{display:flex;align-items:flex-start;gap:12px;width:100%;padding:12px 16px;background:transparent;border:0;border-top:.5px solid var(--dsw-alias-border-l2);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .12s ease}
.tapd-row:first-of-type{border-top:0}
.tapd-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tapd-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.tapd-rowMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.tapd-rowTitle{font-size:14px;font-weight:500;line-height:22px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.tapd-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.tapd-metaItem{display:inline-flex;align-items:center;gap:4px;min-width:0}
.tapd-rowSummary{font-size:13px;line-height:18px;color:var(--dsw-alias-label-tertiary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.tapd-rowEnd{flex:none;color:var(--dsw-alias-label-dimmed);padding-top:4px}
.tapd-row:hover .tapd-rowEnd{color:var(--dsw-alias-label-tertiary)}

/* 空态 / 骨架 */
.tapd-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:56px 16px 60px;text-align:center}
.tapd-emptyIcon{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;margin-bottom:6px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);color:var(--dsw-alias-label-tertiary)}
.tapd-emptyTitle{font-size:14px;font-weight:500;line-height:22px}
.tapd-emptyText{font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);max-width:360px}
.tapd-skel{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-top:.5px solid var(--dsw-alias-border-l2)}
.tapd-skel:first-of-type{border-top:0}
.tapd-skelBar{height:12px;border-radius:6px;background:var(--dsw-alias-bg-skeleton);animation:tapdPulse 1.5s ease-in-out infinite}
@keyframes tapdPulse{0%,100%{opacity:1}50%{opacity:.5}}
@keyframes tapdSpin{to{transform:rotate(360deg)}}
.tapd-spin{animation:tapdSpin .9s linear infinite}

/* 详情 */
.tapd-detailTitle{margin:0;font-size:20px;font-weight:500;line-height:28px;letter-spacing:-0.01em;word-break:break-word}
.tapd-desc{padding:16px;font-size:14px;line-height:24px;white-space:pre-wrap;word-break:break-word}
.tapd-descEmpty{padding:16px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}

/* 提示条 */
.tapd-alert{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.tapd-alert[data-tone=error]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 22%,transparent);color:var(--dsw-alias-state-error-primary)}
.tapd-alert[data-tone=success]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 22%,transparent);color:var(--dsw-alias-state-success-primary)}
.tapd-alertIcon{flex:none;margin-top:1px}
.tapd-result{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:min(100%,460px);font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.tapd-result>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tapd-result[data-tone=success]{color:var(--dsw-alias-state-success-primary)}
.tapd-result[data-tone=error]{color:var(--dsw-alias-state-error-primary)}

@media (max-width:600px){
  .tapd-toolbar{width:100%;margin-left:0}
  .tapd-search{flex:1;width:auto;min-width:0}
  .tapd-field{flex-direction:column;gap:6px}
  .tapd-fieldText{padding-top:0}
  .tapd-fieldControl{width:100%}
}
`;

    /**
     * 往 `<head>` 里装一次样式表。卸载时整块移除，避免残留。
     * @param id 样式表标识
     * @param css 样式文本
     * @returns 清理函数
     */
    function installStyles(id, css) {
      if (typeof document === 'undefined' || !document.head) return () => {};
      const selector = `style[data-tapd-css="${id}"]`;
      let tag = document.querySelector(selector);
      if (!tag) {
        tag = document.createElement('style');
        tag.dataset.tapdCss = id;
        tag.textContent = css;
        document.head.appendChild(tag);
      }
      return () => {
        if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
      };
    }

    //#endregion
    //#region 图标

    /**
     * 16px 线性图标路径。线条 1.5、圆角端点，和宿主自带的图标同一套观感。
     * 只收面板用得到的几个，不引整套图标库。
     */
    const ICONS = {
      checklist: [
        'M2.6 3.2h10.8a1 1 0 0 1 1 1v8.6a1 1 0 0 1-1 1H2.6a1 1 0 0 1-1-1V4.2a1 1 0 0 1 1-1z',
        'M4.8 6.2h6.4M4.8 8.5h6.4M4.8 10.8h3.6',
      ],
      search: ['M7.3 12.6a5.3 5.3 0 1 0 0-10.6 5.3 5.3 0 0 0 0 10.6z', 'M11.2 11.2 14 14'],
      refresh: ['M13.2 8a5.2 5.2 0 1 1-1.55-3.68', 'M13.4 2.6v3h-3'],
      settings: [
        'M2.6 4.6h10.8M2.6 11.4h10.8',
        'M5.6 2.7a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8z',
        'M10.4 9.5a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8z',
      ],
      chevronRight: ['M6.2 3.6 10.6 8l-4.4 4.4'],
      chevronLeft: ['M9.8 3.6 5.4 8l4.4 4.4'],
      chevronDown: ['M3.6 6.2 8 10.6l4.4-4.4'],
      external: ['M9.2 2.6h4.2v4.2', 'M13.4 2.6 7.2 8.8', 'M12 9.8v2.8a1 1 0 0 1-1 1H3.6a1 1 0 0 1-1-1V5.2a1 1 0 0 1 1-1h2.8'],
      copy: [
        'M5.6 5.6h6.8a1 1 0 0 1 1 1v6.8a1 1 0 0 1-1 1H5.6a1 1 0 0 1-1-1V6.6a1 1 0 0 1 1-1z',
        'M10.4 5.6V3.6a1 1 0 0 0-1-1H3.6a1 1 0 0 0-1 1v5.8a1 1 0 0 0 1 1h1',
      ],
      check: ['M3.4 8.4 6.4 11.4 12.6 5'],
      alert: ['M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4z', 'M8 7.2v3.4', 'M8 4.9v.2'],
      info: ['M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4z', 'M8 7.4v3.4', 'M8 5.1v.2'],
      close: ['M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8'],
      link: [
        'M6.6 9.4 9.4 6.6',
        'M7.4 4.6l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1',
        'M8.6 11.4l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1',
      ],
    };

    /**
     * 线性图标。
     * @param props.name ICONS 里的名字
     * @param props.size 边长，默认 16
     * @param props.className 附加类名（如旋转动画）
     */
    function Icon({ name, size = 16, className }) {
      const paths = ICONS[name] || [];
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className,
          'aria-hidden': true,
          focusable: false,
        },
        paths.map((d, index) => h('path', { key: index, d })),
      );
    }

    /**
     * 侧栏图标：带勾的清单，与面板内容呼应。
     * @param props.size 图标边长
     */
    function PanelIcon({ size }) {
      return h(Icon, { name: 'checklist', size: typeof size === 'number' ? size : 16 });
    }

    //#endregion
    //#region 基础组件

    /**
     * 按钮。尺寸 / 变体与宿主 `Button` 一致：md 36px、sm 28px。
     * @param props.variant primary | outline | ghost（默认）
     * @param props.size md | sm
     * @param props.icon 图标节点，渲染在文字左侧
     */
    function Btn({ variant = 'ghost', size = 'md', icon, children, className, ...rest }) {
      return h(
        'button',
        {
          ...rest,
          type: 'button',
          className: ['tapd-btn', className].filter(Boolean).join(' '),
          'data-variant': variant,
          'data-size': size,
        },
        ...(icon ? [h('span', { className: 'tapd-btnIcon', key: 'icon' }, icon)] : []),
        ...(children === undefined || children === null ? [] : [children]),
      );
    }

    /**
     * 状态 / 属性小标签。
     * @param props.tone success | info | warning | danger | neutral | outline
     */
    function Chip({ tone = 'neutral', children, title }) {
      return h('span', { className: 'tapd-tag', 'data-tone': tone, title }, children);
    }

    /**
     * 一行设置项：左侧标签与说明，右侧控件（和宿主设置页同一套排法）。
     * @param props.label 标签文字
     * @param props.description 标签下方的说明
     * @param props.badge 标签右侧的小标记（如「已保存」）
     * @param props.secret 是否密码框
     */
    function Field({ label, description, badge, secret, ...inputProps }) {
      return h(
        'label',
        { className: 'tapd-field' },
        h(
          'span',
          { className: 'tapd-fieldText' },
          h('span', { className: 'tapd-fieldLabel' }, label, badge || null),
          description ? h('span', { className: 'tapd-fieldDesc' }, description) : null,
        ),
        h(
          'span',
          { className: 'tapd-fieldControl' },
          h('input', {
            ...inputProps,
            className: 'tapd-input',
            type: secret ? 'password' : 'text',
            autoComplete: 'off',
            spellCheck: false,
          }),
        ),
      );
    }

    /**
     * 顶部提示条。
     * @param props.tone error | success | info
     */
    function Alert({ tone = 'info', children }) {
      const icon = tone === 'error' ? 'alert' : tone === 'success' ? 'check' : 'info';
      return h(
        'div',
        { className: 'tapd-alert', 'data-tone': tone, role: tone === 'error' ? 'alert' : 'status' },
        h('span', { className: 'tapd-alertIcon' }, h(Icon, { name: icon, size: 14 })),
        h('span', { style: { minWidth: 0 } }, children),
      );
    }

    /**
     * 搜索框（受控）。
     * @param props.value 当前关键词
     * @param props.onChange 输入回调
     * @param props.onSubmit 回车 / 清空后的提交回调
     */
    function SearchBox({ value, onChange, onSubmit, placeholder }) {
      return h(
        'div',
        { className: 'tapd-search' },
        h('span', { className: 'tapd-searchIcon' }, h(Icon, { name: 'search', size: 14 })),
        h('input', {
          className: 'tapd-searchInput',
          value,
          placeholder,
          'aria-label': placeholder,
          onChange: (event) => onChange(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') onSubmit(event.currentTarget.value);
          },
        }),
        value
          ? h(
              'button',
              {
                type: 'button',
                className: 'tapd-searchClear',
                'aria-label': '清空',
                onClick: () => {
                  onChange('');
                  onSubmit('');
                },
              },
              h(Icon, { name: 'close', size: 10 }),
            )
          : null,
      );
    }

    //#endregion
    //#region 业务组件

    /**
     * TAPD 状态 → 标签色调。
     *
     * TAPD 的 `status` 既可能是中文（实现中），也可能是英文键（developing），
     * 两种都认；认不出来的一律走中性色，不要瞎猜成「已完成」。
     */
    const STATUS_TONES = [
      [/已完成|已上线|已发布|done|resolved|closed|released/i, 'success'],
      [/已拒绝|已取消|拒绝|取消|rejected|cancelled|canceled|invalid/i, 'danger'],
      [/测试|验收|testing|verif|review/i, 'warning'],
      [/实现|开发|进行|启动|develop|progress|doing|started/i, 'info'],
      [/规划|新建|未开始|待处理|plan|new|open|todo/i, 'neutral'],
    ];

    /** 优先级里需要突出的几档。 */
    const PRIORITY_TONES = [
      [/^(高|紧急|最高|urgent|high|highest)$/i, 'danger'],
      [/^(中|middle|medium|normal)$/i, 'warning'],
      [/^(低|low|lowest)$/i, 'neutral'],
    ];

    /**
     * 按文字猜色调。
     * @param table 规则表
     * @param text 待判定的文字
     * @returns 命中的色调，未命中返回 fallback
     */
    function toneOf(table, text, fallback) {
      const raw = typeof text === 'string' ? text.trim() : '';
      for (const [pattern, tone] of table) {
        if (pattern.test(raw)) return tone;
      }
      return fallback;
    }

    /**
     * 列表里的一行需求。
     * @param props.story 需求摘要
     * @param props.onOpen 点开回调
     */
    function StoryRow({ story, onOpen }) {
      const meta = [];
      if (story.status) meta.push(h(Chip, { key: 'status', tone: toneOf(STATUS_TONES, story.status, 'neutral') }, story.status));
      if (story.owner) meta.push(h('span', { key: 'owner', className: 'tapd-metaItem' }, story.owner));
      if (story.priority_label) {
        meta.push(
          h('span', { key: 'priority', className: 'tapd-metaItem' }, `优先级 ${story.priority_label}`),
        );
      }
      if (story.modified) meta.push(h('span', { key: 'modified', className: 'tapd-metaItem' }, String(story.modified).slice(0, 10)));
      meta.push(h('span', { key: 'id', className: 'tapd-metaItem tapd-mono' }, `#${story.id}`));

      return h(
        'button',
        { type: 'button', className: 'tapd-row', onClick: () => onOpen(story), title: story.name || story.id },
        h(
          'span',
          { className: 'tapd-rowMain' },
          h('span', { className: 'tapd-rowTitle' }, story.name || '(无标题)'),
          h('span', { className: 'tapd-meta' }, ...meta),
          story.summary ? h('span', { className: 'tapd-rowSummary' }, story.summary) : null,
        ),
        h('span', { className: 'tapd-rowEnd' }, h(Icon, { name: 'chevronRight', size: 16 })),
      );
    }

    /** 列表加载骨架。 */
    function Skeleton() {
      const widths = [
        ['72%', '40%', '86%'],
        ['58%', '34%', '64%'],
        ['80%', '44%', '90%'],
        ['46%', '30%', '72%'],
      ];
      return h(
        'div',
        { className: 'tapd-card', 'aria-hidden': true },
        ...widths.map((rows, index) =>
          h(
            'div',
            { className: 'tapd-skel', key: index },
            ...rows.map((width, line) =>
              h('span', {
                key: line,
                className: 'tapd-skelBar',
                style: { width, height: line === 0 ? 13 : 11 },
              }),
            ),
          ),
        ),
      );
    }

    /**
     * 空态。
     * @param props.title 标题
     * @param props.text 说明
     * @param props.action 动作按钮（可选）
     * @param props.icon 图标名（默认清单）
     */
    function Empty({ title, text, action, icon = 'checklist' }) {
      return h(
        'div',
        { className: 'tapd-empty' },
        h('span', { className: 'tapd-emptyIcon' }, h(Icon, { name: icon, size: 20 })),
        h('div', { className: 'tapd-emptyTitle' }, title),
        text ? h('div', { className: 'tapd-emptyText' }, text) : null,
        action || null,
      );
    }

    /**
     * 配置页。
     * @param props.config 当前配置视图
     * @param props.onSaved 保存回调，返回是否成功
     * @param props.onTest 探活回调，接收未保存的表单值
     * @param props.busy 保存中
     */
    function SettingsPage({ config, onSaved, onTest, busy, t }) {
      const [form, setForm] = useState(() => ({
        workspaceId: config.workspaceId || '',
        apiToken: '',
        apiUser: config.apiUser || '',
        apiPassword: '',
        baseUrl: config.baseUrl || 'https://api.tapd.cn',
      }));
      const [advanced, setAdvanced] = useState(false);
      const [testing, setTesting] = useState(false);
      const [result, setResult] = useState(null);

      const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

      /**
       * 表单当前值 → 配置补丁。密钥留空表示「不修改」，
       * 清空要显式点对应动作才有意义。
       * @returns 待提交的字段
       */
      const buildPatch = () => {
        const patch = {
          workspaceId: form.workspaceId.trim(),
          apiUser: form.apiUser.trim(),
          baseUrl: form.baseUrl.trim(),
        };
        if (form.apiToken.trim() !== '') patch.apiToken = form.apiToken.trim();
        if (form.apiPassword.trim() !== '') patch.apiPassword = form.apiPassword.trim();
        return patch;
      };

      const submit = async () => {
        setResult(null);
        const ok = await onSaved(buildPatch());
        // 只有真存下去了才清空密钥框，否则用户得重新粘一遍令牌
        if (ok !== false) setForm((prev) => ({ ...prev, apiToken: '', apiPassword: '' }));
      };

      const probe = async () => {
        setTesting(true);
        setResult(null);
        try {
          // 允许「先填、先测、再保存」：把屏幕上的值一起带去做探活
          setResult(await onTest(buildPatch()));
        } catch (error) {
          setResult({ ok: false, error: String((error && error.message) || error) });
        } finally {
          setTesting(false);
        }
      };

      const tokenBadge = config.hasToken
        ? h(Chip, { tone: 'success' }, t('saved'))
        : null;
      const basicBadge = config.hasBasic ? h(Chip, { tone: 'success' }, t('saved')) : null;

      return h(
        'div',
        { className: 'tapd-stack' },
        h(
          'div',
          { className: 'tapd-card' },
          h('div', { className: 'tapd-cardHead' }, h('h2', { className: 'tapd-cardTitle' }, t('groupProject'))),
          h(
            'div',
            { className: 'tapd-cardBody' },
            h(Field, {
              label: t('workspaceId'),
              value: form.workspaceId,
              placeholder: '10104801',
              onChange: set('workspaceId'),
              description: t('workspaceIdDesc'),
            }),
            h(Field, {
              label: t('baseUrl'),
              value: form.baseUrl,
              placeholder: 'https://api.tapd.cn',
              onChange: set('baseUrl'),
              description: t('baseUrlDesc'),
            }),
          ),
        ),
        h(
          'div',
          { className: 'tapd-card' },
          h('div', { className: 'tapd-cardHead' }, h('h2', { className: 'tapd-cardTitle' }, t('groupAuth'))),
          h(
            'div',
            { className: 'tapd-cardBody' },
            h(Field, {
              label: t('apiToken'),
              badge: tokenBadge,
              secret: true,
              value: form.apiToken,
              placeholder: config.hasToken ? '••••••••' : '粘贴个人访问令牌',
              onChange: set('apiToken'),
              description: t('apiTokenDesc'),
            }),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
              h(
                Btn,
                {
                  size: 'sm',
                  variant: 'ghost',
                  onClick: () => setAdvanced((prev) => !prev),
                  style: { alignSelf: 'flex-start', marginLeft: -10 },
                  'aria-expanded': advanced,
                },
                h(
                  'span',
                  {
                    style: {
                      display: 'inline-flex',
                      transform: advanced ? 'rotate(180deg)' : 'none',
                      transition: 'transform .12s ease',
                    },
                  },
                  h(Icon, { name: 'chevronDown', size: 14 }),
                ),
                t('advanced'),
                basicBadge,
              ),
              advanced
                ? h(
                    'div',
                    { className: 'tapd-row2' },
                    h(Field, {
                      label: t('apiUser'),
                      value: form.apiUser,
                      placeholder: '开放应用 ID',
                      onChange: set('apiUser'),
                    }),
                    h(Field, {
                      label: t('apiPassword'),
                      secret: true,
                      value: form.apiPassword,
                      placeholder: '应用秘钥',
                      onChange: set('apiPassword'),
                      description: t('advancedDesc'),
                    }),
                  )
                : null,
            ),
          ),
          h(
            'div',
            { className: 'tapd-cardFoot' },
            h(Btn, { variant: 'primary', onClick: submit, disabled: busy }, busy ? t('saving') : t('save')),
            h(Btn, { variant: 'outline', onClick: probe, disabled: testing || busy }, testing ? t('testing') : t('test')),
            result
              ? h(
                  'span',
                  { className: 'tapd-result', 'data-tone': result.ok ? 'success' : 'error' },
                  h(Icon, { name: result.ok ? 'check' : 'alert', size: 14 }),
                  h(
                    'span',
                    { style: { minWidth: 0 } },
                    result.ok
                      ? `${t('testOk')}${result.sample ? ` · ${result.sample}` : ''}`
                      : String(result.error || t('testFail')),
                  ),
                )
              : null,
          ),
        ),
      );
    }

    /**
     * 需求详情。
     * @param props.detail { row, story, loading, error }
     */
    function StoryDetail({ detail, onBack, onRetry, onCopy, t }) {
      // 详情还没回来时先用列表行兜底，标题不会闪空
      const story = detail.story || detail.row || {};
      const meta = [];
      if (story.status) meta.push(h(Chip, { key: 'status', tone: toneOf(STATUS_TONES, story.status, 'neutral') }, story.status));
      if (story.priority_label) meta.push(h(Chip, { key: 'priority', tone: toneOf(PRIORITY_TONES, story.priority_label, 'outline') }, `${t('priority')} ${story.priority_label}`));
      if (story.owner) meta.push(h('span', { key: 'owner', className: 'tapd-metaItem' }, `${t('owner')} ${story.owner}`));
      if (story.modified) meta.push(h('span', { key: 'modified', className: 'tapd-metaItem' }, `${t('modified')} ${String(story.modified).slice(0, 16)}`));
      meta.push(h('span', { key: 'id', className: 'tapd-metaItem tapd-mono' }, `#${story.id}`));

      let body;
      if (detail.loading) {
        body = h(
          'div',
          { className: 'tapd-card' },
          h(
            'div',
            { className: 'tapd-skel' },
            h('span', { className: 'tapd-skelBar', style: { width: '92%', height: 12 } }),
            h('span', { className: 'tapd-skelBar', style: { width: '78%', height: 12 } }),
            h('span', { className: 'tapd-skelBar', style: { width: '85%', height: 12 } }),
            h('span', { className: 'tapd-skelBar', style: { width: '46%', height: 12 } }),
          ),
        );
      } else if (detail.error) {
        body = h(
          'div',
          { className: 'tapd-card' },
          h(
            'div',
            { className: 'tapd-cardBody' },
            h(Alert, { tone: 'error' }, detail.error),
            h(
              'div',
              { style: { display: 'flex', gap: 8 } },
              h(Btn, { variant: 'outline', onClick: onRetry }, t('retry')),
              h(Btn, { onClick: onBack }, t('back')),
            ),
          ),
        );
      } else {
        body = h(
          'div',
          { className: 'tapd-card' },
          h('div', { className: 'tapd-cardHead' }, h('h2', { className: 'tapd-cardTitle' }, t('description'))),
          story.description
            ? h('div', { className: 'tapd-desc' }, story.description)
            : h('div', { className: 'tapd-descEmpty' }, t('noDescription')),
        );
      }

      return h(
        'div',
        { className: 'tapd-stack' },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 } },
          h('h1', { className: 'tapd-detailTitle' }, story.name || '(无标题)'),
          h('div', { className: 'tapd-meta' }, ...meta),
        ),
        body,
      );
    }

    /**
     * 面板主体。
     * @param props 插槽属性（含 t）与环境
     */
    function TapdPage(props) {
      const t = props.t || ((key) => key);
      const [config, setConfig] = useState(null);
      const [booting, setBooting] = useState(true);
      const [showSettings, setShowSettings] = useState(false);
      const [stories, setStories] = useState([]);
      const [keyword, setKeyword] = useState('');
      const [busy, setBusy] = useState(false);
      const [note, setNote] = useState(null);
      const [detail, setDetail] = useState(null);

      const fail = useCallback(
        (error) => setNote({ kind: 'error', text: String((error && error.message) || error) }),
        [],
      );

      const refresh = useCallback(
        async (nextKeyword) => {
          setBusy(true);
          setNote(null);
          try {
            const payload = await loadStories({ keyword: nextKeyword === undefined ? keyword : nextKeyword, limit: PAGE_LIMIT });
            setStories(Array.isArray(payload.stories) ? payload.stories : []);
            if (payload.configured === false) {
              setShowSettings(true);
              setNote({ kind: 'info', text: t('needConfig') });
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
            if (view.configured) await refresh('');
            else {
              setShowSettings(true);
              setNote({ kind: 'info', text: t('needConfig') });
            }
          } catch (error) {
            if (alive) fail(error);
          } finally {
            if (alive) setBooting(false);
          }
        })();
        return () => {
          alive = false;
        };
        // 只在挂载时跑一次
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      // 成功提示自己消失，别一直挂在页面上
      useEffect(() => {
        if (!note || note.kind !== 'ok') return undefined;
        const timer = setTimeout(() => setNote(null), 2600);
        return () => clearTimeout(timer);
      }, [note]);

      const save = useCallback(
        async (patch) => {
          setBusy(true);
          setNote(null);
          try {
            const view = await saveConfig(patch);
            setConfig(view);
            if (view.configured) {
              setShowSettings(false);
              await refresh('');
            }
            // refresh 失败时它自己会写错误提示，别用「已保存」把它盖掉
            setNote((prev) => prev || { kind: 'ok', text: t('saved') });
            return true;
          } catch (error) {
            fail(error);
            return false;
          } finally {
            setBusy(false);
          }
        },
        [fail, refresh, t],
      );

      const openStory = useCallback(async (row) => {
        setDetail({ row, story: null, loading: true, error: null });
        try {
          const story = await loadStory(row.id);
          setDetail({ row, story, loading: false, error: null });
        } catch (error) {
          setDetail({ row, story: null, loading: false, error: String((error && error.message) || error) });
        }
      }, []);

      const retryDetail = useCallback(() => {
        if (detail) openStory(detail.row);
      }, [detail, openStory]);

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

      const configured = Boolean(config && config.configured);
      const view = detail ? 'detail' : showSettings || !configured ? 'settings' : 'list';

      const subtitle = useMemo(() => {
        if (!config) return t('subtitle');
        const parts = [];
        if (config.workspaceId) parts.push(`#${config.workspaceId}`);
        parts.push(config.hasBasic ? t('authBasic') : config.hasToken ? t('authToken') : t('notConfigured'));
        return parts;
      }, [busy, config, stories.length, t, view]);

      const heading = (title, intro) =>
        h(
          'div',
          { className: 'tapd-heading' },
          h('h1', { className: 'tapd-title' }, title),
          h(
            'p',
            { className: 'tapd-intro' },
            ...(Array.isArray(intro)
              ? intro.flatMap((item, index) => (index === 0 ? [item] : [h('span', { key: index, className: 'tapd-dot' }), item]))
              : [intro]),
          ),
        );

      let headerLeft;
      let headerRight;
      if (view === 'detail') {
        const story = detail.story || detail.row || {};
        headerLeft = h(
          'div',
          { className: 'tapd-crumbRow' },
          h(
            'div',
            { className: 'tapd-crumb' },
            h(
              Btn,
              { size: 'sm', variant: 'ghost', icon: h(Icon, { name: 'chevronLeft', size: 14 }), onClick: () => setDetail(null) },
              t('back'),
            ),
            h('span', { className: 'tapd-crumbCurrent' }, t('detailTitle')),
          ),
        );
        headerRight = h(
          'div',
          { className: 'tapd-toolbar' },
          h(
            Btn,
            { size: 'sm', variant: 'ghost', icon: h(Icon, { name: 'link', size: 14 }), onClick: () => copy(`@tapd:story:${story.id}`) },
            t('copyRef'),
          ),
          h(
            Btn,
            { size: 'sm', variant: 'ghost', icon: h(Icon, { name: 'copy', size: 14 }), onClick: () => copy(String(story.id)) },
            t('copyId'),
          ),
          story.url
            ? h(
                'a',
                {
                  className: 'tapd-btn',
                  'data-variant': 'outline',
                  'data-size': 'sm',
                  href: story.url,
                  target: '_blank',
                  rel: 'noreferrer',
                },
                h('span', { className: 'tapd-btnIcon' }, h(Icon, { name: 'external', size: 14 })),
                t('openInTapd'),
              )
            : null,
        );
      } else if (view === 'settings') {
        headerLeft = heading(t('settingsTitle'), t('settingsIntro'));
        headerRight = h(
          'div',
          { className: 'tapd-toolbar' },
          configured
            ? h(
                Btn,
                { size: 'sm', variant: 'ghost', icon: h(Icon, { name: 'chevronLeft', size: 14 }), onClick: () => setShowSettings(false) },
                t('backList'),
              )
            : null,
        );
      } else {
        headerLeft = heading(t('panelTitle'), subtitle);
        headerRight = h(
          'div',
          { className: 'tapd-toolbar' },
          h(SearchBox, {
            value: keyword,
            onChange: setKeyword,
            onSubmit: (value) => refresh(value),
            placeholder: t('searchPlaceholder'),
          }),
          h(
            Btn,
            {
              size: 'sm',
              variant: 'ghost',
              icon: h(Icon, { name: 'refresh', size: 14, className: busy ? 'tapd-spin' : undefined }),
              onClick: () => refresh(),
              disabled: busy,
            },
            t('refresh'),
          ),
          h(
            Btn,
            { size: 'sm', variant: 'ghost', icon: h(Icon, { name: 'settings', size: 14 }), onClick: () => setShowSettings(true) },
            t('settings'),
          ),
        );
      }

      let body;
      if (view === 'detail') {
        body = h(StoryDetail, { detail, onBack: () => setDetail(null), onRetry: retryDetail, onCopy: copy, t });
      } else if (view === 'settings') {
        // 配置还没读回来时也直接把表单摆上：本地接口是几十毫秒的事，
        // 让用户先看到骨架反而闪烁，而且首次进入本来就该填表。
        body = h(SettingsPage, { config: config || {}, onSaved: save, onTest: testConnection, busy, t });
      } else if (busy || booting) {
        body = Skeleton();
      } else if (stories.length === 0) {
        body = h(
          'div',
          { className: 'tapd-card' },
          h(Empty, {
            title: keyword ? t('emptySearchTitle') : t('emptyTitle'),
            text: keyword ? t('emptySearchText') : t('emptyText'),
            icon: keyword ? 'search' : 'checklist',
            action: keyword
              ? h(
                  Btn,
                  { variant: 'outline', size: 'sm', onClick: () => {
                    setKeyword('');
                    refresh('');
                  }, style: { marginTop: 8 } },
                  t('clearSearch'),
                )
              : h(
                  Btn,
                  { variant: 'outline', size: 'sm', onClick: () => setShowSettings(true), style: { marginTop: 8 } },
                  t('settings'),
                ),
          }),
        );
      } else {
        body = h(
          'div',
          { className: 'tapd-stack' },
          h(
            'div',
            { className: 'tapd-sectionHead' },
            h('h2', { className: 'tapd-cardTitle' }, t('listTitle')),
            keyword ? h('span', { className: 'tapd-hint' }, t('keywordHint', { keyword })) : null,
            busy ? h('span', { className: 'tapd-hint' }, t('loading')) : null,
          ),
          h('div', { className: 'tapd-card' }, ...stories.map((story) => h(StoryRow, { key: story.id, story, onOpen: openStory }))),
        );
      }

      const noteTone = !note ? null : note.kind === 'error' ? 'error' : note.kind === 'ok' ? 'success' : 'info';

      return h(
        'div',
        { className: 'tapd-root' },
        h(
          'div',
          { className: 'tapd-bar' },
          h('div', { className: 'tapd-barInner' }, headerLeft, headerRight),
        ),
        h(
          'div',
          { className: 'tapd-body' },
          h(
            'div',
            { className: 'tapd-bodyInner' },
            note ? h(Alert, { tone: noteTone }, note.text) : null,
            body,
          ),
        ),
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
      ctx.effect(() => installStyles('tapd-in-dsh', STYLE_CSS), 'tapd-in-dsh: styles');

      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh: {
              panel: 'TAPD',
              panelTitle: 'TAPD 需求',
              subtitle: 'TAPD 需求',
              notConfigured: '还没配置',
              needConfig: '先填项目 ID 和访问令牌，保存后就能看到需求列表。',
              settingsTitle: '连接设置',
              settingsIntro: '填一次就存在本机，会话里的 TAPD 工具和这个面板共用同一份配置。',
              groupProject: '项目',
              groupAuth: '凭据',
              workspaceId: '项目 ID',
              workspaceIdDesc: 'TAPD 地址里 /tapd_fe/<项目 ID>/ 那一段；不是公司 ID。',
              baseUrl: '接口地址',
              baseUrlDesc: '私有化部署才需要改，默认 https://api.tapd.cn。',
              apiToken: '个人访问令牌',
              apiTokenDesc: 'TAPD 右上角头像 → 个人设置 → 个人访问令牌。免费版填这个就够。',
              advanced: '开放应用鉴权（可选）',
              advancedDesc: '团队分发时用开放应用 ID + 秘钥，与令牌二选一。',
              apiUser: '开放应用 ID',
              apiPassword: '应用秘钥',
              save: '保存',
              saving: '保存中…',
              saved: '已保存',
              test: '测试连接',
              testing: '连接中…',
              testOk: '连上了',
              testFail: '连不上',
              retry: '重试',
              refresh: '刷新',
              settings: '设置',
              back: '返回',
              backList: '返回列表',
              detailTitle: '需求详情',
              searchPlaceholder: '按标题搜索',
              clearSearch: '清空搜索',
              loading: '读取中…',
              listTitle: '需求列表',
              keywordHint: '关键词「{keyword}」',
              description: '描述',
              emptyTitle: '这个项目下没有需求',
              emptyText: '需求都建在别的项目里？去设置里换一个项目 ID。',
              emptySearchTitle: '没搜到匹配的需求',
              emptySearchText: '换个关键词试试，TAPD 的标题搜索是包含匹配。',
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
              panelTitle: 'TAPD stories',
              subtitle: 'TAPD stories',
              notConfigured: 'Not configured',
              needConfig: 'Fill in the project ID and an access token, then save to load stories.',
              settingsTitle: 'Connection',
              settingsIntro: 'Saved once on this machine; the console tools and this panel share the same settings.',
              groupProject: 'Project',
              groupAuth: 'Credentials',
              workspaceId: 'Project ID',
              workspaceIdDesc: 'The /tapd_fe/<project id>/ segment of your TAPD URL — not the company ID.',
              baseUrl: 'API endpoint',
              baseUrlDesc: 'Only for on-premise deployments. Default https://api.tapd.cn.',
              apiToken: 'Personal access token',
              apiTokenDesc: 'TAPD avatar → Personal settings → Personal access tokens.',
              advanced: 'Open app credentials (optional)',
              advancedDesc: 'For team distribution. Use either this or the token.',
              apiUser: 'App ID',
              apiPassword: 'App secret',
              save: 'Save',
              saving: 'Saving…',
              saved: 'Saved',
              test: 'Test connection',
              testing: 'Testing…',
              testOk: 'Connected',
              testFail: 'Not connected',
              retry: 'Retry',
              refresh: 'Refresh',
              settings: 'Settings',
              back: 'Back',
              backList: 'Back to list',
              detailTitle: 'Story',
              searchPlaceholder: 'Search by title',
              clearSearch: 'Clear search',
              loading: 'Loading…',
              listTitle: 'Stories',
              keywordHint: 'keyword "{keyword}"',
              description: 'Description',
              emptyTitle: 'No stories in this project',
              emptyText: 'Stories live in another project? Change the project ID in settings.',
              emptySearchTitle: 'No matching stories',
              emptySearchText: 'Try another keyword — TAPD matches titles by substring.',
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
