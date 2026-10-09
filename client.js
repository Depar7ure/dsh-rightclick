/**
 * dsh-rightclick — RightClick（浏览器半）。
 *
 * 需求：在 DSH GUI 里右键「对话区空白处」或「侧边栏空白处」，弹出上下文菜单，
 * 菜单含：刷新 / 归档 / 撤销 / 重做 / 复制 / 粘贴 / 打开新对话 / 打开分支对话。
 *
 * ── 八个动作的落地方式（均已核实到官方实现） ───────────────────────────────────
 * · 刷新            `window.location.reload()`；若装了 dsh-desktop-web-refresh，先问
 *                   它的 `/api/active` —— 有对话在跑就不刷，避免截断。接口不可用
 *                   （没装那个插件）时按用户意图直接刷。
 * · 归档            官方 `ctx.get('uiWorkspace').archiveSession(sessionId)`。被
 *                   `workspace/session-active` 拒绝时，菜单内联提示并给出
 *                   「停止并归档」（`{ stopActivity: true }`），不静默强杀。
 * · 撤销 / 重做     DSH 没有会话级撤销（不存在撤回已发送消息的能力），这两个作用于
 *                   输入框的编辑器历史。先把焦点还给 composer 的 contenteditable，
 *                   再走 `document.execCommand('undo'|'redo')` —— Chromium 会派发
 *                   `beforeinput`(`inputType: historyUndo/Redo`)，正是 Lexical 接管
 *                   历史的入口。失败则提示用户手动按快捷键。
 * · 复制            选区优先；没有选区时取当前会话最后一条助手回复的纯文本。
 * · 粘贴            `navigator.clipboard.readText()` → 聚焦 composer →
 *                   `document.execCommand('insertText', …)` 插入到光标处。
 * · 打开新对话      `ctx.get('uiWorkspace').startSession()`。
 * · 打开分支对话    `forkSession(sessionId)` 拿到子会话 id 后 `openSession(childId)`；
 *                   没有可分支的已完成轮次时官方抛 `session/fork-unavailable`。
 *
 * ── 实现约束 ──────────────────────────────────────────────────────────────────
 * · 没有任何通用右键菜单插槽（131 个客户端 bundle 里 `onContextMenu` 零命中），
 *   现有右键菜单在 Electron 主进程，插件够不到 —— 所以自己监听 + 自绘。
 * · UI 挂在 `shell.overlay` 槽（list / root）。该层为
 *   `div[data-shell-overlay]{position:absolute;inset:0;z-index:20;pointer-events:none}`
 *   且 `>*{pointer-events:auto}`：菜单可点，菜单之外点击穿透回页面（所以「点击外部
 *   关闭」必须靠 document 监听，不能用遮罩层）。
 * · 样式只用 `--dsw-alias-*` 主题 token；不 require 任何 Harness Client 包；
 *   不往文档根追加常驻 DOM（只有剪贴板兜底用的离屏 textarea，用完即移除）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-rightclick',
  factory(require) {
    'use strict';

    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useLayoutEffect, useRef, useState } = React;

    /** Client locale 命名空间；与 slots.register 的 locale 选项一致。 */
    const NS = 'rightclick';

    /** dsh-desktop-web-refresh 的活跃对话查询（装了才用，没装就当 null）。 */
    const ACTIVE_API = '/plugins/dsh-desktop-web-refresh/api/active';

    const dictionaries = {
      zh: {
        title: 'RightClick',
        refresh: '刷新',
        archive: '归档',
        undo: '撤销',
        redo: '重做',
        copy: '复制',
        paste: '粘贴',
        newConversation: '打开新对话',
        branch: '打开分支对话',
        needSession: '需要先打开一个会话',
        needComposer: '输入框不可用',
        needClipboard: '当前环境不支持读取剪贴板',
        noService: '所需服务不可用',
        failed: '操作失败',
        refreshBlocked: '有 {n} 个对话正在运行，暂不能刷新',
        archiveBlocked: '该会话仍有 {n} 项运行中的工作',
        archiveStop: '停止并归档',
        forkUnavailable: '没有可分支的已完成轮次',
        copyEmpty: '没有可复制的内容',
        copyFailed: '写入剪贴板失败',
        pasteEmpty: '剪贴板里没有文本',
        pasteDenied: '无法读取剪贴板（可能缺少权限）',
        pasteFailed: '插入文本失败',
        undoFailed: '编辑器不支持撤销，请按 Ctrl+Z',
        redoFailed: '编辑器不支持重做，请按 Ctrl+Y',
      },
      en: {
        title: 'RightClick',
        refresh: 'Refresh',
        archive: 'Archive',
        undo: 'Undo',
        redo: 'Redo',
        copy: 'Copy',
        paste: 'Paste',
        newConversation: 'New conversation',
        branch: 'Branch conversation',
        needSession: 'Open a conversation first',
        needComposer: 'The composer is unavailable',
        needClipboard: 'Clipboard reading is unavailable here',
        noService: 'Required service unavailable',
        failed: 'Action failed',
        refreshBlocked: '{n} conversation(s) still running — cannot refresh',
        archiveBlocked: 'This session still has {n} running item(s)',
        archiveStop: 'Stop and archive',
        forkUnavailable: 'No completed turn to branch from',
        copyEmpty: 'Nothing to copy',
        copyFailed: 'Could not write to the clipboard',
        pasteEmpty: 'The clipboard has no text',
        pasteDenied: 'Could not read the clipboard (permission?)',
        pasteFailed: 'Could not insert the text',
        undoFailed: 'Editor does not support undo — press Ctrl+Z',
        redoFailed: 'Editor does not support redo — press Ctrl+Y',
      },
    };

    /** 极简插值：只认 `{name}`，不依赖 locale 服务的占位符方言。 */
    function fmt(text, values) {
      return String(text).replace(/\{(\w+)\}/g, (match, key) =>
        values[key] === undefined ? match : String(values[key]),
      );
    }

    // ────────────────────────────── 数据契约（选择器） ──────────────────────────────
    //
    // 只使用两类锚点，避免绑到会随 DSH 版本变化的 CSS-module 哈希类名
    // （`BynINW_` / `_2H3hWW_` / `_9lTDKa_` / `xz4KEq_` 这类）：
    //   · 框架级契约 `[data-slot="…"]` —— ui-renderer 为每个插槽出口渲染
    //     `div[data-slot="<key>"]{display:contents}`，宿主自己的 CSS 也在依赖它；
    //   · 宿主 JS 自身在用的 `data-*` 属性。
    const SEL = {
      sidebar: '[data-slot="sidebar"]',
      sidebarWorkspaces: '[data-slot="sidebar.workspaces"]',
      row: '[data-row-key]',
      chatScroll: '[data-conversation-scroll]',
      composer: '[data-composer-seat], [data-conversation-region="composer"], [contenteditable="true"]',
      chatItem: '[data-chat-anchor-key], [data-chat-flow-key], [data-chat-group-key], [data-tool]',
      interactive:
        'button, a, input, textarea, select, summary, [role="button"], [role="menuitem"], [role="tab"], [role="link"], [role="checkbox"], [role="switch"]',
      /** 输入座：定位 composer 的 contenteditable。 */
      composerSeat: '[data-composer-seat], [data-conversation-region="composer"]',
      /** 当前会话 id 的 DOM 兜底。 */
      conversationSession: '[data-conversation-session]',
    };

    /**
     * 判定右键落点是否属于我们要接管的两块「空白区域」。
     *
     * @param {EventTarget|null} node - contextmenu 事件的 target。
     * @returns {'conversation'|'sidebar'|null} 命中的区域；null 表示放行原生菜单。
     */
    function hitRegion(node) {
      if (node === null || node === undefined) return null;
      if (!(node instanceof Element)) return null;

      // 闸一：任何交互控件、输入区、消息行，一律放行。
      if (node.closest(SEL.interactive)) return null;
      if (node.closest(SEL.composer)) return null;

      // 闸二：对话区。
      if (node.closest(SEL.chatScroll)) {
        if (node.closest(SEL.chatItem)) return null;
        return 'conversation';
      }

      // 闸三：侧边栏。
      if (node.closest(SEL.sidebarWorkspaces)) {
        if (node.closest(SEL.row)) return null;
        return 'sidebar';
      }
      if (node.closest(SEL.sidebar)) return null;

      return null;
    }

    // ────────────────────────────── 宿主能力访问 ──────────────────────────────

    /**
     * 当前会话 id。官方自己就是这么取的：会话投影里 `retainedBy.mainView > 0`
     * 的那条就是主视图正在显示的会话（见 dsh-client-ui-workspace 里
     * `Object.values(sessions.list.getSnapshot().byId).find(...)` 那段）。
     * 投影拿不到时退回读 DOM 上的 `[data-conversation-session]`。
     */
    function currentSessionId(ctx) {
      try {
        const snapshot = ctx.get('sessions')?.list?.getSnapshot?.();
        const byId = snapshot?.byId ?? {};
        for (const row of Object.values(byId)) {
          if ((row?.retainedBy?.mainView ?? 0) > 0) return String(row.id);
        }
      } catch {
        /* 投影不可用，走 DOM 兜底 */
      }
      const node = document.querySelector(SEL.conversationSession);
      const value = node === null ? null : node.getAttribute('data-conversation-session');
      return value === null || value === '' ? null : value;
    }

    /** composer 的 contenteditable 根（Lexical 的编辑器根元素）。 */
    function composerEditable() {
      const seat = document.querySelector(SEL.composerSeat);
      const scope = seat === null ? document : seat;
      const node = scope.querySelector('[contenteditable="true"]');
      return node instanceof HTMLElement ? node : null;
    }

    /** 把键盘还给 composer；Lexical 会同时恢复它存储的选区。 */
    function focusComposer(node) {
      try {
        node.focus({ preventScroll: true });
      } catch {
        node.focus();
      }
    }

    /** 当前选区文本（没有选区时返回空串）。 */
    function selectedText() {
      const selection = window.getSelection();
      return selection === null ? '' : String(selection.toString());
    }

    /**
     * 当前会话最后一条助手回复的纯文本，用于「没有选区时」的复制兜底。
     * `data-chat-flow-kind` 是宿主自己在用的分组键，助手步骤的取值是
     * `assistant-step`；取不到时退到轮次尾部的 `turn-tail`。
     * 用 `innerText` 是因为它只统计渲染出来的文本，hover 才出现的按钮文字不计入。
     */
    function lastAssistantText() {
      const probes = ['assistant-step', 'turn-tail'];
      for (const kind of probes) {
        const nodes = document.querySelectorAll('[data-chat-flow-kind="' + kind + '"]');
        if (nodes.length === 0) continue;
        const text = String(nodes[nodes.length - 1].innerText || '').trim();
        if (text !== '') return text;
      }
      return '';
    }

    /** 写剪贴板：优先异步 Clipboard API，失败退到 execCommand 兜底。 */
    async function writeClipboard(text) {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          /* 落到 execCommand 兜底 */
        }
      }
      const exec =
        typeof document.execCommand === 'function' ? document.execCommand.bind(document) : undefined;
      if (exec === undefined) return false;
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      document.documentElement.appendChild(el);
      el.select();
      try {
        return exec('copy');
      } catch {
        return false;
      } finally {
        el.remove();
      }
    }

    /**
     * 问一次 dsh-desktop-web-refresh 有多少对话在跑。
     * @returns {Promise<number|null>} 数字=运行中的对话数；null=问不到（插件没装/请求失败）。
     */
    async function queryRunningSessions() {
      try {
        const response = await fetch(ACTIVE_API, { cache: 'no-store' });
        if (!response.ok) return null;
        const data = await response.json();
        if (data?.ok !== true || data.known !== true) return null;
        return Number(data.count) || 0;
      } catch {
        return null;
      }
    }

    /**
     * 官方 `workspace/session-active` 拒绝里带的活动清单。
     * 类身份靠 name 判断 —— 客户端插件 bundle 之间不共享错误类实例。
     * @returns {Array<{kind: string, items: Array}>|undefined}
     */
    function activeSessionRefusal(reason) {
      if (!(reason instanceof Error) || reason.name !== 'WorkspaceArchiveError') return undefined;
      const rpcError = reason.rpcError;
      if (rpcError === undefined || rpcError === null) return undefined;
      return rpcError.code === 'workspace/session-active' ? rpcError.details?.activity : undefined;
    }

    function describeError(error, t) {
      if (error instanceof Error && typeof error.message === 'string' && error.message !== '') {
        return error.message;
      }
      const text = String(error);
      return text === '' || text === 'undefined' ? t('failed') : text;
    }

    // ────────────────────────────── 菜单结构与样式 ──────────────────────────────

    /**
     * 菜单项。顺序沿用需求原文：刷新 / 归档 / 撤销 / 重做 / 复制 / 粘贴 /
     * 打开新对话 / 打开分支对话。
     * `key` 是快捷键提示字母；`needs` 声明该条目依赖的运行时条件。
     */
    const ITEMS = [
      { id: 'refresh', label: 'refresh' },
      { id: 'archive', label: 'archive', needs: 'session' },
      { type: 'separator' },
      { id: 'undo', label: 'undo', key: 'Z', needs: 'composer' },
      { id: 'redo', label: 'redo', key: 'Y', needs: 'composer' },
      { id: 'copy', label: 'copy', key: 'C' },
      { id: 'paste', label: 'paste', key: 'V', needs: 'clipboard' },
      { type: 'separator' },
      { id: 'new', label: 'newConversation' },
      { id: 'branch', label: 'branch', needs: 'session' },
    ];

    /** 可被方向键停留的下标。 */
    const SELECTABLE = ITEMS.map((item, index) => (item.id === undefined ? -1 : index)).filter(
      (index) => index >= 0,
    );

    /** 条件不满足时给出的原因文案键。 */
    const NEEDS_REASON = {
      session: 'needSession',
      composer: 'needComposer',
      clipboard: 'needClipboard',
    };

    /** macOS 用 ⌘；其余平台用 Ctrl+（与 DSH 自己的 primary 修饰键语义一致）。 */
    const IS_MAC =
      typeof navigator !== 'undefined' &&
      /mac/i.test(String(navigator.platform || navigator.userAgent || ''));

    function keyHint(letter) {
      return IS_MAC ? '⌘' + letter : 'Ctrl+' + letter;
    }

    /** 组件级样式：跟随 <style> 元素的卸载自动移除，不污染宿主样式表。 */
    const CSS = [
      '.rc-menu{position:fixed;z-index:40;min-width:216px;box-sizing:border-box;',
      'padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);',
      'box-shadow:0 10px 32px rgba(0,0,0,0.22),0 1px 2px rgba(0,0,0,0.16);',
      'font-size:13px;line-height:18px;user-select:none}',
      '.rc-item{display:flex;box-sizing:border-box;width:100%;align-items:center;',
      'justify-content:space-between;gap:20px;padding:6px 10px;border:0;border-radius:6px;',
      'background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.rc-item:hover,.rc-item.is-active{background:var(--dsw-alias-bg-layer-2)}',
      '.rc-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.rc-item.is-disabled,.rc-item.is-disabled:hover{color:var(--dsw-alias-label-tertiary);',
      'background:transparent;cursor:default}',
      '.rc-key{color:var(--dsw-alias-label-tertiary);font-size:12px;letter-spacing:0.02em}',
      '.rc-sep{height:1px;margin:5px 6px;background:var(--dsw-alias-border-l2)}',
      '.rc-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;',
      'margin-top:4px;padding:6px 10px 2px;border-top:1px solid var(--dsw-alias-border-l2);',
      'color:var(--dsw-alias-label-secondary);font-size:11px;line-height:15px}',
      '.rc-notice[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '.rc-notice-action{flex:none;border:0;background:transparent;padding:0;font:inherit;',
      'font-size:11px;color:var(--dsw-alias-brand-primary);cursor:pointer;text-decoration:underline}',
    ].join('');

    /** 菜单相对视口边缘的最小留白。 */
    const MARGIN = 12;

    // ────────────────────────────── 八个动作 ──────────────────────────────
    //
    // 每个动作返回：
    //   { ok: true }                         → 关闭菜单
    //   { ok: false, message }               → 保持打开并提示（错误）
    //   { stay: true, message, action }      → 保持打开并提示，附一个可点的后续动作

    const ACTIONS = {
      async refresh(ctx, availability, t) {
        const running = await queryRunningSessions();
        // 问不到（没装 dsh-desktop-web-refresh）就按用户意图刷新；
        // 问得到且确实有对话在跑，才拦下来。
        if (running !== null && running > 0) {
          return { ok: false, message: fmt(t('refreshBlocked'), { n: running }) };
        }
        window.location.reload();
        return { ok: true };
      },

      async archive(ctx, availability, t) {
        const ui = ctx.get('uiWorkspace');
        if (!ui || typeof ui.archiveSession !== 'function') {
          return { ok: false, message: t('noService') };
        }
        if (availability.sessionId === null) {
          return { ok: false, message: t('needSession') };
        }
        try {
          await ui.archiveSession(availability.sessionId);
          return { ok: true };
        } catch (error) {
          const activity = activeSessionRefusal(error);
          if (activity !== undefined) {
            const total = activity.reduce((sum, entry) => sum + ((entry?.items ?? []).length || 0), 0);
            return {
              stay: true,
              tone: 'error',
              message: fmt(t('archiveBlocked'), { n: total }),
              action: { label: t('archiveStop'), run: 'archiveStop' },
            };
          }
          return { ok: false, message: describeError(error, t) };
        }
      },

      /** 「归档」被拒后的二次确认：先停掉那批工作再归档（官方 `stopActivity`）。 */
      async archiveStop(ctx, availability, t) {
        const ui = ctx.get('uiWorkspace');
        if (!ui || typeof ui.archiveSession !== 'function') {
          return { ok: false, message: t('noService') };
        }
        try {
          await ui.archiveSession(availability.sessionId, { stopActivity: true });
          return { ok: true };
        } catch (error) {
          return { ok: false, message: describeError(error, t) };
        }
      },

      async undo(ctx, availability, t) {
        const node = composerEditable();
        if (node === null) return { ok: false, message: t('needComposer') };
        focusComposer(node);
        try {
          // Chromium 会把它转成 beforeinput(inputType=historyUndo)，Lexical 在此接管。
          return document.execCommand('undo') ? { ok: true } : { ok: false, message: t('undoFailed') };
        } catch {
          return { ok: false, message: t('undoFailed') };
        }
      },

      async redo(ctx, availability, t) {
        const node = composerEditable();
        if (node === null) return { ok: false, message: t('needComposer') };
        focusComposer(node);
        try {
          return document.execCommand('redo') ? { ok: true } : { ok: false, message: t('redoFailed') };
        } catch {
          return { ok: false, message: t('redoFailed') };
        }
      },

      async copy(ctx, availability, t) {
        let text = selectedText().trim();
        if (text === '') text = lastAssistantText();
        if (text === '') return { ok: false, message: t('copyEmpty') };
        return (await writeClipboard(text)) ? { ok: true } : { ok: false, message: t('copyFailed') };
      },

      async paste(ctx, availability, t) {
        const node = composerEditable();
        if (node === null) return { ok: false, message: t('needComposer') };
        if (!navigator.clipboard?.readText) return { ok: false, message: t('needClipboard') };
        let text = '';
        try {
          text = await navigator.clipboard.readText();
        } catch {
          return { ok: false, message: t('pasteDenied') };
        }
        if (text === '') return { ok: false, message: t('pasteEmpty') };
        focusComposer(node);
        try {
          return document.execCommand('insertText', false, text)
            ? { ok: true }
            : { ok: false, message: t('pasteFailed') };
        } catch {
          return { ok: false, message: t('pasteFailed') };
        }
      },

      async new(ctx, availability, t) {
        const ui = ctx.get('uiWorkspace');
        if (!ui || typeof ui.startSession !== 'function') {
          return { ok: false, message: t('noService') };
        }
        ui.startSession();
        return { ok: true };
      },

      async branch(ctx, availability, t) {
        const ui = ctx.get('uiWorkspace');
        if (!ui || typeof ui.forkSession !== 'function') {
          return { ok: false, message: t('noService') };
        }
        if (availability.sessionId === null) {
          return { ok: false, message: t('needSession') };
        }
        try {
          const childId = await ui.forkSession(availability.sessionId);
          if (childId !== undefined && typeof ui.openSession === 'function') ui.openSession(childId);
          return { ok: true };
        } catch (error) {
          if (
            error instanceof Error &&
            error.name === 'SessionForkError' &&
            error.rpcError?.code === 'session/fork-unavailable'
          ) {
            return { ok: false, message: t('forkUnavailable') };
          }
          return { ok: false, message: describeError(error, t) };
        }
      },
    };

    /**
     * 打开菜单那一刻的运行时条件。禁用态由此决定（菜单存活时间很短，右键时重算）。
     */
    function computeAvailability(ctx) {
      const sessionId = currentSessionId(ctx);
      const hasComposer = composerEditable() !== null;
      const canReadClipboard =
        typeof navigator !== 'undefined' &&
        navigator.clipboard !== undefined &&
        typeof navigator.clipboard.readText === 'function';
      return {
        sessionId,
        session: sessionId !== null,
        composer: hasComposer,
        clipboard: hasComposer && canReadClipboard,
      };
    }

    // ────────────────────────────── 组件 ──────────────────────────────

    /**
     * `shell.overlay` 里唯一的一个条目：平时什么都不渲染，只在右键命中空白区域时
     * 渲染菜单浮层。所有监听器随组件卸载自动移除。
     */
    function MenuLayer(props) {
      const ctx = props.ctx;
      const t = typeof props.t === 'function' ? props.t : (key) => key;

      const [menu, setMenu] = useState(null);
      const [pos, setPos] = useState(null);
      const [active, setActiveState] = useState(-1);
      const [notice, setNotice] = useState(null);
      const [busy, setBusy] = useState(false);

      const menuRef = useRef(null);
      /** active 的镜像：键盘监听器只装一次，需要读最新值。 */
      const activeRef = useRef(-1);
      /** 打开菜单时的运行时条件（动作里要用）。 */
      const availabilityRef = useRef({
        sessionId: null,
        session: false,
        composer: false,
        clipboard: false,
      });
      const busyRef = useRef(false);

      const setActive = useCallback((value) => {
        activeRef.current = value;
        setActiveState(value);
      }, []);

      const close = useCallback(() => {
        setMenu(null);
        setPos(null);
        setActive(-1);
        setNotice(null);
        busyRef.current = false;
        setBusy(false);
      }, [setActive]);

      /** 执行一个动作（菜单项，或菜单内联提示里的后续动作）。 */
      const runItem = useCallback(
        async (id) => {
          if (busyRef.current) return;
          const action = ACTIONS[id];
          if (typeof action !== 'function') return;
          busyRef.current = true;
          setBusy(true);
          setNotice(null);
          let result;
          try {
            result = await action(ctx, availabilityRef.current, t);
          } catch (error) {
            result = { ok: false, message: describeError(error, t) };
          }
          busyRef.current = false;
          setBusy(false);
          if (result === undefined || result.ok === true) {
            close();
            return;
          }
          // 失败或需要二次确认：菜单留着，把原因写在底部。
          setNotice({
            text: result.message,
            tone: result.tone ?? 'error',
            action: result.action ?? null,
          });
        },
        [close, ctx, t],
      );

      // ── 打开：document 级 contextmenu（捕获阶段，先于任何冒泡处理器） ──
      useEffect(() => {
        function onContextMenu(event) {
          if (event.defaultPrevented) return;
          const region = hitRegion(event.target);
          if (region === null) {
            close();
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const availability = computeAvailability(ctx);
          availabilityRef.current = availability;
          setMenu({ x: event.clientX, y: event.clientY, region, availability });
          setPos(null);
          setActive(-1);
          setNotice(null);
        }
        document.addEventListener('contextmenu', onContextMenu, true);
        return () => document.removeEventListener('contextmenu', onContextMenu, true);
      }, [close, ctx, setActive]);

      // ── 关闭路径 + 键盘导航 ──
      useEffect(() => {
        if (menu === null) return undefined;

        function onKeyDown(event) {
          const key = event.key;
          if (key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          if (key === 'ArrowDown' || key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            if (SELECTABLE.length === 0) return;
            const delta = key === 'ArrowDown' ? 1 : -1;
            const current = SELECTABLE.indexOf(activeRef.current);
            const next =
              current < 0
                ? delta > 0
                  ? 0
                  : SELECTABLE.length - 1
                : (current + delta + SELECTABLE.length) % SELECTABLE.length;
            setActive(SELECTABLE[next]);
            return;
          }
          if (key === 'Enter' || key === ' ') {
            const item = ITEMS[activeRef.current];
            if (item === undefined || item.id === undefined) return;
            event.preventDefault();
            event.stopPropagation();
            runItem(item.id);
          }
        }

        function onPointerDown(event) {
          const node = menuRef.current;
          if (node !== null && node.contains(event.target)) return;
          close();
        }

        function onScroll() {
          close();
        }

        function onResize() {
          close();
        }

        function onBlur() {
          close();
        }

        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        window.addEventListener('blur', onBlur);
        return () => {
          document.removeEventListener('keydown', onKeyDown, true);
          document.removeEventListener('pointerdown', onPointerDown, true);
          window.removeEventListener('scroll', onScroll, true);
          window.removeEventListener('resize', onResize);
          window.removeEventListener('blur', onBlur);
        };
      }, [menu, close, runItem, setActive]);

      // ── 定位：先渲染再量，贴到视口边缘时夹紧；测量完成前保持不可见 ──
      useLayoutEffect(() => {
        if (menu === null) return;
        const node = menuRef.current;
        if (node === null) return;
        const rect = node.getBoundingClientRect();
        let x = menu.x;
        let y = menu.y;
        if (x + rect.width + MARGIN > window.innerWidth) {
          x = Math.max(MARGIN, window.innerWidth - rect.width - MARGIN);
        }
        if (y + rect.height + MARGIN > window.innerHeight) {
          y = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN);
        }
        setPos({ x, y });
      }, [menu]);

      if (menu === null) return null;

      const style =
        pos === null
          ? { left: menu.x + 'px', top: menu.y + 'px', visibility: 'hidden' }
          : { left: pos.x + 'px', top: pos.y + 'px' };

      const availability = menu.availability;

      const rows = ITEMS.map((item, index) => {
        if (item.type === 'separator') {
          return h('div', { key: 'sep-' + index, className: 'rc-sep', role: 'separator' });
        }
        const blocked = item.needs !== undefined && availability[item.needs] !== true;
        return h(
          'button',
          {
            key: item.id,
            type: 'button',
            role: 'menuitem',
            'aria-disabled': blocked || busy ? 'true' : undefined,
            title: blocked ? t(NEEDS_REASON[item.needs]) : undefined,
            className:
              'rc-item' +
              (active === index ? ' is-active' : '') +
              (blocked || busy ? ' is-disabled' : ''),
            tabIndex: -1,
            onClick: () => {
              if (blocked || busy) return;
              runItem(item.id);
            },
            onMouseEnter: () => setActive(index),
          },
          h('span', { className: 'rc-label' }, t(item.label)),
          item.key === undefined ? null : h('span', { className: 'rc-key' }, keyHint(item.key)),
        );
      });

      const footer =
        notice === null
          ? null
          : h(
              'div',
              { className: 'rc-notice', role: 'alert', 'data-tone': notice.tone },
              h('span', null, notice.text),
              notice.action === null
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'rc-notice-action',
                      onClick: () => {
                        if (notice.action !== null) runItem(notice.action.run);
                      },
                    },
                    notice.action.label,
                  ),
            );

      return h(
        'div',
        {
          ref: menuRef,
          className: 'rc-menu',
          role: 'menu',
          'aria-label': t('title'),
          'data-rightclick': menu.region,
          'aria-busy': busy ? 'true' : undefined,
          style,
          onContextMenu: (event) => {
            event.preventDefault();
            event.stopPropagation();
          },
        },
        h('style', null, CSS),
        rows,
        footer,
      );
    }

    // ────────────────────────────── 插件 ──────────────────────────────

    return {
      inject: ['slots', 'locale'],

      apply(ctx) {
        // 可见文案走 Client locale 服务；每个语言一个 effect，卸载即注销。
        for (const language of Object.keys(dictionaries)) {
          ctx.effect(() => ctx.locale.register(NS, language, dictionaries[language]));
        }

        // shell.overlay：list/root 槽，覆盖整窗的浮层宿主（见文件头说明）。
        // MenuLayer 需要 ctx 才能取 sessions / uiWorkspace，用闭包包一层传进去。
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'rightclick',
              order: 1000,
              locale: NS,
            },
            (props) => h(MenuLayer, { ...props, ctx }),
          ),
        );
      },
    };
  },
});
