import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type FakeTab = {
  id: number;
  url: string;
  title?: string;
  active?: boolean;
  groupId?: number;
};

function createEvent() {
  const listeners: Function[] = [];
  return {
    addListener(fn: Function) { listeners.push(fn); },
    removeListener(fn: Function) {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    async emit(...args: unknown[]) {
      for (const listener of listeners) await listener(...args);
    },
  };
}

function loadBackground(initialTabs: FakeTab[]) {
  const tabs = new Map<number, FakeTab>();
  for (const tab of initialTabs) tabs.set(tab.id, { groupId: -1, ...tab });
  let nextTabId = Math.max(0, ...initialTabs.map(t => t.id)) + 1;

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    sent: string[] = [];

    constructor(readonly url: string) {}
    send(data: string) { this.sent.push(data); }
  }

  const onCompleted = createEvent();
  const onActivated = createEvent();
  const onRemoved = createEvent();

  const chrome = {
    action: {
      setBadgeText() {},
      setBadgeBackgroundColor() {},
    },
    runtime: {
      onMessage: createEvent(),
      onStartup: createEvent(),
      onInstalled: createEvent(),
    },
    webNavigation: {
      onCompleted,
    },
    scripting: {
      async executeScript() {},
    },
    tabs: {
      onActivated,
      onRemoved,
      async query(query: { active?: boolean }) {
        const values = [...tabs.values()];
        return query.active ? values.filter(t => t.active) : values;
      },
      async get(tabId: number) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`No tab: ${tabId}`);
        return { ...tab };
      },
      async create(options: { url?: string; active?: boolean }) {
        const tab = {
          id: nextTabId++,
          url: options.url || 'about:blank',
          active: options.active ?? true,
          groupId: -1,
        };
        tabs.set(tab.id, tab);
        return { ...tab };
      },
      async update(tabId: number, props: Partial<FakeTab>) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`No tab: ${tabId}`);
        if (props.active) {
          for (const value of tabs.values()) value.active = false;
        }
        Object.assign(tab, props);
        return { ...tab };
      },
      async remove(tabId: number) {
        tabs.delete(tabId);
        await onRemoved.emit(tabId);
      },
      async goBack() {},
      async goForward() {},
      async reload() {},
      async sendMessage() {
        return { result: { ok: true } };
      },
      async captureVisibleTab() {
        return 'data:image/png;base64,ZmFrZQ==';
      },
    },
  };

  const context = {
    chrome,
    WebSocket: FakeWebSocket,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
  };

  const source = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context: context as typeof context & { handleCommand: Function }, tabs, chrome };
}

describe('extension tab stability', () => {
  it('recovers from an internal extension tab by targeting the active content tab', async () => {
    const { context } = loadBackground([
      { id: 1, url: 'chrome-extension://pilot/popup.html', active: false },
      { id: 2, url: 'https://jobs.example/apply', active: true },
    ]);

    const recovered = await context.handleCommand('get_url', {}, 'session-1', 1);
    expect(recovered).toEqual({ url: 'https://jobs.example/apply', tabId: 2 });

    const remembered = await context.handleCommand('get_url', {}, 'session-1');
    expect(remembered).toEqual({ url: 'https://jobs.example/apply', tabId: 2 });
  });

  it('creates a replacement tab when the mapped tab is gone and no content tab is active', async () => {
    const { context } = loadBackground([
      { id: 1, url: 'chrome://extensions', active: true },
    ]);

    const recovered = await context.handleCommand('get_url', {}, 'session-1', 99);
    expect(recovered).toEqual({ url: 'about:blank', tabId: 2 });
  });
});

describe('broker extension routing stability', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/extension-server.ts'), 'utf8');
  const backgroundSource = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');
  const contentSource = fs.readFileSync(path.join(ROOT, 'extension/content.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));

  it('preserves caller-provided tab overrides when forwarding through the broker', () => {
    expect(source).toContain('const tabId = msg.tabId ?? this.sessionTabs.get(sessionId);');
    expect(source).toContain('tabId: overrideTabId');
  });

  it('has extension-side heartbeat handling in addition to MCP client pruning', () => {
    expect(source).toContain("if (msg.type === 'keepalive') return;");
    expect(source).toContain("console.error('[pilot] Heartbeat: extension unresponsive");
  });

  it('uses an offscreen document and alarm fallback to keep the MV3 service worker awake', () => {
    expect(manifest.permissions).toContain('offscreen');
    expect(manifest.permissions).toContain('alarms');
    expect(fs.existsSync(path.join(ROOT, 'extension/offscreen.html'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'extension/offscreen.js'))).toBe(true);
    expect(backgroundSource).toContain('ensureOffscreen()');
    expect(backgroundSource).toContain("msg.type === 'offscreen_keepalive'");
    expect(backgroundSource).toContain("chrome.alarms.create(RECONNECT_ALARM");
  });

  it('routes portal text clicks and file uploads through the extension content script', () => {
    expect(manifest.permissions).toContain('debugger');
    expect(backgroundSource).toContain("case 'click_text':");
    expect(backgroundSource).toContain("case 'dom_find':");
    expect(backgroundSource).toContain('Input.dispatchMouseEvent');
    expect(backgroundSource).toContain("relayToContent('find_text_rect'");
    expect(backgroundSource).toContain("case 'upload_file':");
    expect(contentSource).toContain("case 'dom_find':");
    expect(contentSource).toContain('function domFind');
    expect(contentSource).toContain('clickSelector: cssPath(clickTarget)');
    expect(contentSource).toContain('function findVisibleTextElement');
    expect(contentSource).toContain("case 'find_text_rect':");
    expect(contentSource).toContain('new DataTransfer()');
    expect(contentSource).toContain('input.files = dt.files');
  });
});
