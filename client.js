/**
 * Deferred ask — queue a question now, have it delivered only during DeepSeek
 * off-peak pricing windows.
 *
 * Peak (Asia/Shanghai, no DST): Mon–Fri 09:00–12:00 and 14:00–18:00.
 * Everything else — including weekends and public holidays — is off-peak, where
 * DeepSeek bills half the peak rate.
 *
 * The queue is never scheduled ahead of time with an `at` timing: missed
 * occurrences are replayed on the next launch, which could land in a peak
 * window. Instead a 30s ticker waits for the clock to actually be off-peak and
 * only then creates a schedule that fires 5 seconds later.
 */
window.__ModuleLoader__.load({
  id: 'dsh-deferred-ask',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'deferredAsk';
    const STORE_KEY = 'dsh.deferredAsk.queue.v1';
    const SLOT = 'conversation.composer.dock';
    const TICK_MS = 30_000;
    const UI_TICK_MS = 15_000;
    const MAX_ITEMS = 50;
    const MAX_TITLE = 100;

    // The dock entry is the primary surface. This flag reports whether it
    // actually mounted, so a floating pill can take over when the dock slot is
    // missing or its renderer crashed — the feature never disappears silently.
    let dockMounted = false;
    const mountListeners = new Set();

    function setDockMounted(value) {
      if (dockMounted === value) return;
      dockMounted = value;
      for (const listener of [...mountListeners]) {
        try {
          listener();
        } catch {
          /* a broken subscriber must not break the rest */
        }
      }
    }

    function useDockMounted() {
      const [mounted, setMounted] = React.useState(dockMounted);
      React.useEffect(() => {
        const listener = () => setMounted(dockMounted);
        mountListeners.add(listener);
        setMounted(dockMounted);
        return () => {
          mountListeners.delete(listener);
        };
      }, []);
      return mounted;
    }

    // Midnight-free zone math: shift into UTC+8 and read UTC fields.
    const ZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
    const PEAK_WINDOWS = [
      [9 * 60, 12 * 60],
      [14 * 60, 18 * 60],
    ];
    // Weekday names live in the locale dictionaries (`dayShort.0`–`dayShort.6`).

    function zoneParts(ms) {
      const d = new Date(ms + ZONE_OFFSET_MS);
      return {
        day: d.getUTCDay(),
        minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
        date: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      };
    }

    function isPeak(ms) {
      const { day, minutes } = zoneParts(ms);
      if (day === 0 || day === 6) return false;
      for (const [from, to] of PEAK_WINDOWS) {
        if (minutes >= from && minutes < to) return true;
      }
      return false;
    }

    function nextOffPeak(ms) {
      const base = Math.floor(ms / 60_000) * 60_000;
      for (let i = 0; i <= 4 * 24 * 60; i += 1) {
        const at = base + i * 60_000;
        if (!isPeak(at)) return at;
      }
      return null;
    }

    function clock(ms) {
      const d = new Date(ms + ZONE_OFFSET_MS);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    }

    function dayLabel(ms, translate) {
      return translate(`dayShort.${zoneParts(ms).day}`);
    }

    function remaining(ms) {
      const minutes = Math.max(0, Math.round(ms / 60_000));
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return hours > 0 ? `${hours}h${String(rest).padStart(2, '0')}m` : `${rest}m`;
    }

    function whenLabel(at, translate) {
      if (!at) return '';
      const now = Date.now();
      const sameDay = zoneParts(at).date === zoneParts(now).date;
      return sameDay ? clock(at) : translate('otherDay', { day: dayLabel(at, translate), time: clock(at) });
    }

    function firstLine(text) {
      const line = String(text || '').trim().split('\n')[0].trim();
      return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line;
    }

    function errorText(error) {
      if (!error) return 'unknown error';
      if (typeof error === 'string') return error;
      const code = error.code ? String(error.code) : '';
      const message = error.message ? String(error.message) : String(error);
      return code && !message.includes(code) ? `${code}: ${message}` : message;
    }

    // ---------------------------------------------------------------- store --

    let queue = [];
    const listeners = new Set();

    function sanitize(items) {
      if (!Array.isArray(items)) return [];
      return items
        .filter((item) => item && typeof item.text === 'string' && item.text.trim() !== '')
        .slice(0, MAX_ITEMS)
        .map((item) => ({
          id: typeof item.id === 'string' && item.id ? item.id : newId(),
          text: item.text,
          createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
          mode: item.mode === 'session' ? 'session' : 'new_once',
          cwd: typeof item.cwd === 'string' && item.cwd ? item.cwd : undefined,
          sessionId: typeof item.sessionId === 'string' && item.sessionId ? item.sessionId : undefined,
          failures: Number.isFinite(item.failures) ? item.failures : 0,
          nextAttemptAt: Number.isFinite(item.nextAttemptAt) ? item.nextAttemptAt : 0,
          error: typeof item.error === 'string' ? item.error : undefined,
        }));
    }

    function newId() {
      return `dda-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function readQueue() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY);
        return sanitize(raw ? JSON.parse(raw) : []);
      } catch {
        return [];
      }
    }

    function commit(next) {
      queue = sanitize(next);
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(queue));
      } catch {
        /* storage is best effort; the in-memory queue still works */
      }
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          /* a broken subscriber must not break the rest */
        }
      }
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    queue = readQueue();

    // Where a "new session" delivery lands. The Workspace Controller cannot name
    // the folder for every Session and the Session list carries no cwd, so the
    // panel lets the user pin one folder; the choice is remembered.
    const TARGET_KEY = 'dsh.deferredAsk.target.v1';

    // `null` means "not pinned": the panel then uses whatever it could resolve.
    // An empty string means the user pinned "continue this session" explicitly,
    // which must win over a resolved folder.
    function readTarget() {
      try {
        const raw = window.localStorage.getItem(TARGET_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed.path === 'string' ? parsed.path : null;
      } catch {
        return null;
      }
    }

    function writeTarget(path) {
      try {
        if (path === null) window.localStorage.removeItem(TARGET_KEY);
        else window.localStorage.setItem(TARGET_KEY, JSON.stringify({ path }));
      } catch {
        /* storage is best effort */
      }
    }

    // -------------------------------------------------------------- deliver --

    function buildTitle(text, translate) {
      return `${translate('titlePrefix')}${firstLine(text)}`.slice(0, 120);
    }

    function buildRequest(item, translate) {
      if (item.mode === 'session' && !item.sessionId) return null;
      const request = {
        title: buildTitle(item.text, translate),
        prompt: item.text,
        timing: { kind: 'after', after_seconds: 5 },
      };
      if (item.mode === 'session' && item.sessionId) {
        request.target = { kind: 'session', sessionId: item.sessionId };
      } else {
        request.target = { kind: 'new_once', create: item.cwd ? { cwd: item.cwd } : {} };
      }
      return request;
    }

    async function sendItem(remote, item, translate) {
      const request = buildRequest(item, translate);
      if (!request) return { ok: false, error: translate('noSession') };
      const created = await remote.schedule.create(request);
      if (created && created.ok) return { ok: true };
      return { ok: false, error: errorText(created && created.error) };
    }

    // A single in-flight guard for the whole plugin: the ticker, the "enqueue now"
    // path and repeated "send now" clicks all share one queue, so two runs that
    // read the same snapshot would deliver the same item twice.
    const inFlight = new Set();

    async function drain(service, translate, options) {
      const force = Boolean(options && options.force);
      const only = options && options.itemId ? options.itemId : null;
      if (!force && isPeak(Date.now())) return;
      if (!service || !service.schedule) return;

      const snapshot = readQueue();
      const now = Date.now();
      // Filter before slicing: a targeted send must reach an item beyond the first
      // four, otherwise the button silently does nothing.
      const candidates = only
        ? snapshot.filter((item) => item.id === only)
        : force
          ? snapshot
          : snapshot.filter((item) => item.nextAttemptAt <= now);
      const due = candidates.slice(0, 4);

      for (const item of due) {
        if (inFlight.has(item.id)) continue;
        inFlight.add(item.id);
        try {
          let outcome;
          try {
            outcome = await sendItem(service, item, translate);
          } catch (error) {
            outcome = { ok: false, error: errorText(error) };
          }
          const current = readQueue();
          const index = current.findIndex((entry) => entry.id === item.id);
          if (index >= 0) {
            if (outcome.ok) {
              current.splice(index, 1);
            } else {
              const failures = (current[index].failures || 0) + 1;
              const backoffMs = Math.min(5 * 60_000 * 2 ** (failures - 1), 60 * 60_000);
              current[index] = {
                ...current[index],
                failures,
                error: outcome.error,
                nextAttemptAt: force ? 0 : Date.now() + backoffMs,
              };
            }
            commit(current);
          }
        } finally {
          inFlight.delete(item.id);
        }
      }
    }

    // --------------------------------------------------------------- locale --

    const ZH = {
      title: '低谷待发',
      titlePrefix: '延迟提问：',
      empty: '暂无待发',
      idleEmpty: '当前低谷计价 · 空闲价 = 高峰价 × 0.5',
      peakEmpty: '距下次低谷 {remaining}（{when}）',
      peakCountdown: '{count} 条待发 · 距下次低谷 {remaining}（{when}）',
      idleCountdown: '{count} 条待发 · 低谷中，30 秒内发出',
      open: '展开',
      close: '收起',
      placeholder: '写下你的问题。它会在下一个低谷计价窗口自动发出，并在新会话里保存下来。',
      enqueue: '排入低谷队列',
      enqueueHint: 'Ctrl+Enter 排入 · 低谷价 = 高峰价 × 0.5（周一至周五 09:00–12:00、14:00–18:00 之外，含周末与法定节假日）',
      clear: '清空队列',
      sendNow: '现在发送',
      remove: '删除',
      modeNew: '新会话',
      modeSession: '本会话',
      noTarget: '无法确定工作区目录，将续在本会话',
      noTargetDetail: '{message}（{detail}）',
      targetDir: '发送到：{path}',
      pickTarget: '新建会话的目录：',
      staySession: '将在当前会话继续追问（不新建会话）',
      pickSession: '续在本会话（不新建）',
      pickAuto: '自动选择',
      unavailable: 'schedule 服务不可用，队列只能暂存',
      failed: '发送失败：{message}',
      queuedAt: '{time} 排入',
      confirmClear: '清空全部 {count} 条待发问题？',
      tooMany: '队列已满（{max} 条），先发掉一些再加。',
      emptyDraft: '先写点什么。',
      noSession: '这里没有可用的会话，先固定一个目录再排入。',
      renderFailed: '低谷待发渲染失败：{message}',
      otherDay: '{day} {time}',
      'dayShort.0': '周日',
      'dayShort.1': '周一',
      'dayShort.2': '周二',
      'dayShort.3': '周三',
      'dayShort.4': '周四',
      'dayShort.5': '周五',
      'dayShort.6': '周六',
    };

    const EN = {
      title: 'Off-peak queue',
      titlePrefix: 'Deferred ask: ',
      empty: 'Nothing queued',
      idleEmpty: 'Off-peak now · half price',
      peakEmpty: '{remaining} to off-peak ({when})',
      peakCountdown: '{count} queued · {remaining} to off-peak ({when})',
      idleCountdown: '{count} queued · off-peak, sending within ~30s',
      open: 'Expand',
      close: 'Collapse',
      placeholder: 'Write your question. It fires during the next off-peak window in a fresh session.',
      enqueue: 'Queue for off-peak',
      enqueueHint: 'Ctrl+Enter to queue · off-peak = half price (outside Mon–Fri 09:00–12:00, 14:00–18:00 Asia/Shanghai)',
      clear: 'Clear queue',
      sendNow: 'Send now',
      remove: 'Remove',
      modeNew: 'New session',
      modeSession: 'This session',
      noTarget: 'Workspace folder unknown — will continue this session',
      noTargetDetail: '{message} ({detail})',
      targetDir: 'Target: {path}',
      pickTarget: 'Folder for the new session:',
      staySession: 'Follow up inside this session (no new session)',
      pickSession: 'Continue this session instead',
      pickAuto: 'Choose automatically',
      unavailable: 'schedule service unavailable — items stay queued',
      failed: 'Send failed: {message}',
      queuedAt: 'queued {time}',
      confirmClear: 'Clear all {count} queued questions?',
      tooMany: 'Queue is full ({max}); send some first.',
      emptyDraft: 'Write something first.',
      noSession: 'No session available here — pin a folder first.',
      renderFailed: 'Off-peak queue failed to render: {message}',
      otherDay: '{day} {time}',
      'dayShort.0': 'Sun',
      'dayShort.1': 'Mon',
      'dayShort.2': 'Tue',
      'dayShort.3': 'Wed',
      'dayShort.4': 'Thu',
      'dayShort.5': 'Fri',
      'dayShort.6': 'Sat',
    };

    function interpolate(template, params) {
      let out = template;
      for (const [key, value] of Object.entries(params || {})) {
        out = out.split(`{${key}}`).join(String(value));
      }
      return out;
    }

    function localeId(service) {
      try {
        const snapshot = service.getLocale();
        const value = snapshot && (snapshot.locale || snapshot.id || snapshot.current);
        return typeof value === 'string' ? value : 'zh';
      } catch {
        return 'zh';
      }
    }

    function makeFallback(service) {
      return (key, params) => {
        const table = localeId(service).toLowerCase().startsWith('zh') ? ZH : EN;
        const template = table[key] !== undefined ? table[key] : ZH[key] !== undefined ? ZH[key] : key;
        return interpolate(template, params);
      };
    }

    function makeTranslator(service) {
      const fallback = makeFallback(service);
      let bound = null;
      try {
        bound = service.bind(NS);
      } catch {
        bound = null;
      }
      return (key, params) => {
        if (!bound) return fallback(key, params);
        try {
          const value = bound(key, params);
          if (typeof value !== 'string' || value === '' || value === key) return fallback(key, params);
          return value;
        } catch {
          return fallback(key, params);
        }
      };
    }

    // ------------------------------------------------------------------- UI --

    const STYLE = `
.dda-root { display: flex; flex-direction: column; gap: 6px; padding: 2px 2px 0; font-size: 12px; }
.dda-float { position: fixed; right: 16px; bottom: 16px; width: 320px; max-width: calc(100vw - 32px); z-index: 40; pointer-events: auto; }
.dda-bar { display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; text-align: left; font: inherit; }
.dda-bar:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.dda-bar-live { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dda-bar-alert { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.dda-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.dda-label { font-weight: 600; flex: none; }
.dda-meta { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dda-chevron { flex: none; opacity: 0.7; }
.dda-panel { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.dda-input { width: 100%; box-sizing: border-box; min-height: 64px; max-height: 220px; resize: vertical; padding: 8px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; line-height: 1.5; }
.dda-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dda-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dda-row-target { margin-top: 2px; }
.dda-select { max-width: 100%; padding: 4px 6px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; }
.dda-spacer { flex: 1 1 auto; }
.dda-btn { padding: 4px 10px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; cursor: pointer; }
.dda-btn:hover { border-color: var(--dsw-alias-border-l2); }
.dda-btn:disabled { opacity: 0.5; cursor: default; }
.dda-btn-primary { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); font-weight: 600; }
.dda-btn-primary:not(:disabled):hover { background: var(--dsw-alias-bg-layer-1); }
.dda-hint { color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.dda-warn { color: var(--dsw-alias-state-warn-primary); }
.dda-error { color: var(--dsw-alias-state-error-primary); }
.dda-list { display: flex; flex-direction: column; gap: 6px; }
.dda-item { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 7px 8px; background: var(--dsw-alias-bg-base); display: flex; flex-direction: column; gap: 4px; }
.dda-item-text { color: var(--dsw-alias-label-primary); white-space: pre-wrap; word-break: break-word; max-height: 72px; overflow: hidden; }
.dda-item-meta { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary); }
.dda-badge { padding: 0 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); }
.dda-tag-now { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dda-empty { color: var(--dsw-alias-label-secondary); }
`;

    function useTranslator(service) {
      const [snapshot, setSnapshot] = React.useState(0);
      React.useEffect(() => {
        if (!service) return undefined;
        let dispose = null;
        try {
          dispose = service.subscribe(() => setSnapshot((value) => value + 1));
        } catch {
          dispose = null;
        }
        return () => {
          if (typeof dispose === 'function') dispose();
        };
      }, [service]);
      return React.useMemo(
        () => (service ? makeTranslator(service) : makeFallback(undefined)),
        [service, snapshot],
      );
    }

    function useQueue() {
      const [items, setItems] = React.useState(queue);
      React.useEffect(() => {
        setItems(queue);
        return subscribe(() => setItems(queue));
      }, []);
      return items;
    }

    function useNow(active) {
      const [now, setNow] = React.useState(Date.now());
      React.useEffect(() => {
        if (!active) return undefined;
        const id = window.setInterval(() => setNow(Date.now()), UI_TICK_MS);
        return () => window.clearInterval(id);
      }, [active]);
      return now;
    }

    // The Workspace folder for a Session lives in the Workspace Controller, not
    // in the Session snapshot (which carries no cwd) and not in the slot props
    // (`useWorkspaces` is only supplied when the Workspace UI is loaded).
    function pickWorkspacePath(snapshot, sessionId) {
      const items = snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
      const usable = items.filter((workspace) => workspace && typeof workspace.path === 'string' && workspace.path);
      for (const workspace of usable) {
        const ids = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [];
        if (sessionId && ids.indexOf(sessionId) !== -1) return workspace.path;
      }
      /* A single registered Workspace is unambiguous: the open session lives in it. */
      return usable.length === 1 ? usable[0].path : undefined;
    }

    function useTargetInfo(workspaces, remote, sessionId) {
      const readWorkspace = () => {
        let snapshot;
        try {
          if (!workspaces || !workspaces.list) return { path: undefined, diag: 'no-workspace-service', options: [] };
          snapshot = workspaces.list.getSnapshot();
        } catch (error) {
          return { path: undefined, diag: 'workspace read failed: ' + errorText(error), options: [] };
        }
        const listed = snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
        const options = listed
          .filter((workspace) => workspace && typeof workspace.path === 'string' && workspace.path)
          .map((workspace) => ({
            path: workspace.path,
            title: typeof workspace.title === 'string' && workspace.title ? workspace.title : workspace.path,
          }));
        const path = pickWorkspacePath(snapshot, sessionId);
        if (path) return { path, diag: '', options };
        return { path: undefined, diag: `workspaces=${listed.length} no match`, options };
      };
      const [workspaceInfo, setWorkspaceInfo] = React.useState(readWorkspace);
      const [sessionInfo, setSessionInfo] = React.useState({ path: undefined, diag: '' });
      React.useEffect(() => {
        setWorkspaceInfo(readWorkspace());
        if (!workspaces || !workspaces.list) return undefined;
        try {
          return workspaces.list.subscribe(() => setWorkspaceInfo(readWorkspace()));
        } catch {
          return undefined;
        }
      }, [workspaces, sessionId]);

      // The Host session list always carries the Session's own cwd, so it covers
      // Sessions the Workspace Controller never registered.
      const needsHost = !workspaceInfo.path;
      React.useEffect(() => {
        if (!needsHost) return undefined;
        let live = true;
        const run = async () => {
          let namespace;
          try {
            namespace = remote ? remote.session : undefined;
          } catch {
            namespace = undefined;
          }
          if (!namespace || typeof namespace.list !== 'function') {
            if (live) setSessionInfo({ path: undefined, diag: 'no remote.session' });
            return;
          }
          try {
            const result = await namespace.list({});
            if (!live) return;
            if (!result || !result.ok) {
              const detail = result && result.error ? errorText(result.error) : 'unknown';
              setSessionInfo({ path: undefined, diag: 'session.list failed: ' + detail });
              return;
            }
            const rows = result.value && Array.isArray(result.value.items) ? result.value.items : [];
            const row = rows.filter((entry) => entry && entry.sessionId === sessionId)[0];
            const found = row && typeof row.cwd === 'string' && row.cwd ? row.cwd : undefined;
            setSessionInfo({ path: found, diag: found ? '' : `sessions=${rows.length} no cwd` });
          } catch (error) {
            if (live) setSessionInfo({ path: undefined, diag: 'session.list threw: ' + errorText(error) });
          }
        };
        void run();
        return () => {
          live = false;
        };
      }, [needsHost, remote, sessionId]);

      const options = workspaceInfo.options || [];
      if (workspaceInfo.path) return { path: workspaceInfo.path, diag: '', options };
      if (sessionInfo.path) return { path: sessionInfo.path, diag: '', options };
      const diag = workspaceInfo.diag + ' | ' + (sessionInfo.diag || 'session lookup pending');
      return { path: undefined, diag, options };
    }

    // A crashing panel must stay visible as a readable message instead of a
    // blank strip: the fallback states what broke, in the same seat.
    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      componentDidCatch(error, info) {
        console.warn('[deferred-ask] panel crashed', error, info);
      }

      render() {
        if (this.state.error) {
          return h('div', { className: 'dda-root' },
            h('style', { dangerouslySetInnerHTML: { __html: STYLE } }),
            h('div', { className: 'dda-bar dda-bar-alert', title: errorText(this.state.error) },
              this.props.fallback ? this.props.fallback(errorText(this.state.error)) : errorText(this.state.error)),
          );
        }
        return this.props.children;
      }
    }

    function DockHost(props) {
      React.useEffect(() => {
        setDockMounted(true);
        return () => setDockMounted(false);
      }, []);
      const t = useTranslator(props.localeService || null);
      return h(PanelBoundary, { fallback: (message) => t('renderFailed', { message }) },
        h(DeferredAskDock, props));
    }

    function FloatHost(props) {
      const mounted = useDockMounted();
      const t = useTranslator(props.localeService || null);
      if (mounted) return null;
      return h('div', { className: 'dda-float' },
        h(PanelBoundary, { fallback: (message) => t('renderFailed', { message }) },
          h(DeferredAskDock, props)));
    }

    function DeferredAskDock(props) {
      const service = props.localeService || null;
      const t = useTranslator(service);
      const items = useQueue();
      const [open, setOpen] = React.useState(false);
      const [draft, setDraft] = React.useState('');
      const [notice, setNotice] = React.useState('');
      // The collapsed strip also shows the countdown, so the clock must keep
      // ticking whether or not the panel is expanded.
      const now = useNow(true);
      const peak = isPeak(now);
      const next = peak ? (nextOffPeak(now) || now) : now;
      const remoteAvailable = Boolean(props.remote && props.remote.schedule);
      // Folder for the new session that will receive a queued question.
      const targetInfo = useTargetInfo(props.workspaces, props.remote, props.sessionId);
      const [pinnedTarget, setPinnedTarget] = React.useState(readTarget);
      // A pinned empty string is a deliberate "stay in this session" and must
      // override the auto-resolved folder; only `null` falls back to it.
      const cwd = pinnedTarget === null ? targetInfo.path : pinnedTarget;
      // Another window may pin a folder; keep this panel's three-state in sync.
      React.useEffect(() => {
        const sync = (event) => {
          if (event && event.key && event.key !== TARGET_KEY) return;
          setPinnedTarget(readTarget());
        };
        window.addEventListener('storage', sync);
        return () => window.removeEventListener('storage', sync);
      }, []);
      const failures = items.filter((item) => item.error).length;

      const statusText = items.length > 0
        ? (peak
          ? t('peakCountdown', { count: items.length, remaining: remaining(next - now), when: whenLabel(next, t) })
          : t('idleCountdown', { count: items.length }))
        : (peak
          ? t('peakEmpty', { remaining: remaining(next - now), when: whenLabel(next, t) })
          : t('idleEmpty'));

      const enqueue = () => {
        const text = draft.trim();
        if (!text) {
          setNotice(t('emptyDraft'));
          return;
        }
        const queued = readQueue();
        if (queued.length >= MAX_ITEMS) {
          setNotice(t('tooMany', { max: MAX_ITEMS }));
          return;
        }
        // `shell.overlay` is root-scoped: its props carry no sessionId, so an item
        // queued there cannot "continue this session" — refuse instead of silently
        // flipping the target to a new session on delivery.
        if (!cwd && !props.sessionId) {
          setNotice(t('noSession'));
          return;
        }
        commit([
          ...queued,
          {
            id: newId(),
            text,
            createdAt: Date.now(),
            mode: cwd ? 'new_once' : 'session',
            cwd,
            sessionId: props.sessionId,
            failures: 0,
            nextAttemptAt: 0,
          },
        ]);
        setDraft('');
        setNotice('');
        if (!(props.remote && props.remote.schedule)) setNotice(t('unavailable'));
        else if (!isPeak(Date.now())) void drain(props.remote, t, { force: false });
      };

      const sendNow = (item) => {
        if (!(props.remote && props.remote.schedule)) {
          setNotice(t('unavailable'));
          return;
        }
        void drain(props.remote, t, { force: true, itemId: item.id });
      };

      const remove = (item) => commit(readQueue().filter((entry) => entry.id !== item.id));

      const clear = () => {
        if (items.length === 0) return;
        if (!window.confirm(t('confirmClear', { count: items.length }))) return;
        commit([]);
      };

      const barClass = ['dda-bar'];
      if (failures > 0 || (!remoteAvailable && items.length > 0)) barClass.push('dda-bar-alert');
      else if (!peak && items.length > 0) barClass.push('dda-bar-live');

      return h('div', { className: 'dda-root' },
        h('style', { dangerouslySetInnerHTML: { __html: STYLE } }),
        h('button', {
          type: 'button',
          className: barClass.join(' '),
          onClick: () => setOpen((value) => !value),
          title: open ? t('close') : t('open'),
        },
          h('span', { className: 'dda-dot' }),
          h('span', { className: 'dda-label' }, t('title')),
          h('span', { className: 'dda-meta' }, statusText),
          h('span', { className: 'dda-chevron' }, open ? '▾' : '▸'),
        ),
        open ? h('div', { className: 'dda-panel' },
          h('textarea', {
            className: 'dda-input',
            value: draft,
            placeholder: t('placeholder'),
            spellCheck: false,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                enqueue();
              }
            },
          }),
          h('div', { className: 'dda-row' },
            h('button', {
              type: 'button',
              className: 'dda-btn dda-btn-primary',
              onClick: enqueue,
              disabled: !draft.trim(),
            }, t('enqueue')),
            items.length > 0 ? h('button', { type: 'button', className: 'dda-btn', onClick: clear }, t('clear')) : null,
            h('span', { className: 'dda-spacer' }),
            !remoteAvailable && items.length > 0 ? h('span', { className: 'dda-error' }, t('unavailable')) : null,
          ),
          h('div', { className: 'dda-hint' }, t('enqueueHint')),
          h('div', { className: cwd || pinnedTarget === '' ? 'dda-hint' : 'dda-warn' },
            cwd
              ? t('targetDir', { path: cwd })
              : pinnedTarget === ''
                ? t('staySession')
                : t('noTargetDetail', { message: t('noTarget'), detail: targetInfo.diag })),
          h('div', { className: 'dda-row dda-row-target' },
            h('span', { className: 'dda-hint' }, t('pickTarget')),
            h('select', {
              className: 'dda-select',
              value: pinnedTarget === null ? '__auto__' : pinnedTarget,
              onChange: (event) => {
                const value = event.target.value;
                if (value === '__auto__') {
                  writeTarget(null);
                  setPinnedTarget(null);
                  return;
                }
                writeTarget(value || '');
                setPinnedTarget(value || '');
              },
            },
              h('option', { value: '__auto__' }, t('pickAuto')),
              h('option', { value: '' }, t('pickSession')),
              pinnedTarget && !targetInfo.options.some((option) => option.path === pinnedTarget)
                ? h('option', { value: pinnedTarget }, pinnedTarget)
                : null,
              targetInfo.options.map((option) => h('option', { key: option.path, value: option.path },
                `${option.title} · ${option.path}`)),
            ),
          ),
          notice ? h('div', { className: 'dda-warn' }, notice) : null,
          items.length > 0 ? h('div', { className: 'dda-list' }, items.map((item) => h('div', { className: 'dda-item', key: item.id },
            h('div', { className: 'dda-item-text' }, item.text),
            h('div', { className: 'dda-item-meta' },
              h('span', { className: 'dda-badge' }, item.mode === 'session' ? t('modeSession') : t('modeNew')),
              h('span', null, t('queuedAt', { time: clock(item.createdAt) })),
              item.error ? h('span', { className: 'dda-error', title: item.error }, t('failed', { message: item.error })) : null,
              h('span', { className: 'dda-spacer' }),
              h('button', { type: 'button', className: 'dda-btn', onClick: () => sendNow(item) }, t('sendNow')),
              h('button', { type: 'button', className: 'dda-btn', onClick: () => remove(item) }, t('remove')),
            ),
          ))) : h('div', { className: 'dda-empty' }, t('empty')),
        ) : null,
      );
    }

    // ---------------------------------------------------------------- plugin --

    function apply(ctx) {
      let translate = makeFallback(undefined);
      try {
        // Registered through `ctx.effect` so HMR/unload releases the dictionaries.
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'deferred-ask dictionaries');
        } else {
          ctx.locale.register(NS, { zh: ZH, en: EN });
        }
        translate = makeTranslator(ctx.locale);
      } catch (error) {
        console.warn('[deferred-ask] locale unavailable', error);
        translate = makeFallback(undefined);
      }

      // `ctx.remote` may arrive after this half boots; the bridge keeps the
      // reference lazy so the panel never holds a stale undefined.
      const remoteBridge = {
        get schedule() {
          try {
            return ctx.remote ? ctx.remote.schedule : undefined;
          } catch (error) {
            // Reading a remote namespace without its inject declaration throws.
            // Swallow it so a partially available bridge still renders the panel
            // in its "unavailable" state instead of blanking the whole entry.
            return undefined;
          }
        },
        get session() {
          try {
            return ctx.remote ? ctx.remote.session : undefined;
          } catch (error) {
            return undefined;
          }
        },
      };

      // The Workspace Controller is read through a lazy bridge: `ctx.get` keeps
      // the dependency optional, so a build without the Workspace UI still boots
      // the panel (it just falls back to "this session" targets).
      const workspacesBridge = {
        get list() {
          try {
            const service = typeof ctx.get === 'function' ? ctx.get('workspaces') : ctx.workspaces;
            return service ? service.list : undefined;
          } catch {
            return undefined;
          }
        },
      };

      const surface = (props) => Object.assign({}, props, {
        localeService: ctx.locale,
        remote: remoteBridge,
        workspaces: workspacesBridge,
      });

      try {
        ctx.slots.inject(SLOT, () =>
          ctx.slots.register({ name: SLOT, id: 'deferred-ask', order: 2 }, (props) =>
            h(DockHost, surface(props))));
      } catch (error) {
        console.warn('[deferred-ask] dock registration failed', error);
      }

      try {
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'deferred-ask-floating', order: 50 }, (props) =>
            h(FloatHost, surface(props))));
      } catch (error) {
        console.warn('[deferred-ask] floating registration failed', error);
      }

      try {
        ctx.effect(() => {
          const attempt = () => {
            try {
              Promise.resolve(drain(ctx.remote, translate, { force: false })).catch((error) => {
                console.warn('[deferred-ask] delivery pass failed', error);
              });
            } catch (error) {
              console.warn('[deferred-ask] delivery pass threw', error);
            }
          };
          const id = window.setInterval(attempt, TICK_MS);
          attempt();
          return () => window.clearInterval(id);
        }, 'deferred-ask ticker');
      } catch (error) {
        console.warn('[deferred-ask] ticker unavailable', error);
      }
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.schedule', 'remote.session'],
      apply,
    };
  },
});
