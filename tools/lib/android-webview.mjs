// Read the debug WebView over the runner's isolated ADB forward. No page actions.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [directory, timeoutArgument = '120', portArgument = '9348', profile] = process.argv.slice(2);
if (!Number.isInteger(Number(portArgument)) || Number(portArgument) < 1024 || Number(portArgument) > 65535) throw new Error('Invalid local debug port.');
if (!directory || !Number.isFinite(Number(timeoutArgument)) || Number(timeoutArgument) < 1) {
  throw new Error('Usage: node tools/lib/android-webview.mjs <artifact-directory> [timeout-seconds] [debug-port]');
}
if (typeof WebSocket !== 'function') throw new Error('The Android launcher requires Node.js 22 or newer.');
if (profile && !['phone', 'tablet'].includes(profile)) throw new Error('Invalid emulator profile.');
const output = resolve(directory);
const { productName } = JSON.parse(await readFile(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const deadline = Date.now() + Number(timeoutArgument) * 1000;
const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));
const save = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2));
const events = [];
const pending = new Map();
let socket;
let sequence = 0;
let lastState;
let targets = [];

const send = (method, params = {}) => new Promise((resolveSend, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
  pending.set(id, { resolve: resolveSend, reject, timer });
  socket.send(JSON.stringify({ id, method, params }));
});

try {
  let target;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${portArgument}/json/list`, { signal: AbortSignal.timeout(3000) });
      targets = await response.json();
      target = targets.find((entry) => entry.type === 'page' && /^https?:\/\/tauri\.localhost(?:\/|$)/.test(entry.url));
      if (target?.webSocketDebuggerUrl) break;
    } catch { /* Android may be ready before its WebView debug socket is ready. */ }
    await pause(1000);
  }
  await save('cdp-targets.json', targets);
  if (!target?.webSocketDebuggerUrl) throw new Error('RushLink did not expose its packaged WebView before the timeout.');
  const debugUrl = new URL(target.webSocketDebuggerUrl);
  // WebView reports its local socket address. Always use the dedicated local forward.
  debugUrl.hostname = '127.0.0.1';
  debugUrl.port = portArgument;
  socket = new WebSocket(debugUrl);
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    } else if (message.method && events.length < 300) events.push(message);
  });
  await new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => reject(new Error('WebView debugger connection timed out.')), 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebView debugger connection failed.')); }, { once: true });
  });
  await send('Runtime.enable');
  await send('Page.enable');
  let stable = 0;
  while (Date.now() < deadline) {
    const response = await send('Runtime.evaluate', {
      expression: `(() => {
        const root = document.getElementById('root');
        const workspace = document.querySelector('.app-content');
        const bounds = workspace?.getBoundingClientRect();
        return {
          url: location.href, title: document.title, readyState: document.readyState,
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          screen: { width: screen.width, height: screen.height },
          layout: document.querySelector('.app')?.className,
          tauriAvailable: Boolean(window.__TAURI_INTERNALS__),
          rootChildren: root?.childElementCount ?? 0,
          workspaceVisible: Boolean(bounds && bounds.width > 0 && bounds.height > 0),
          bodyText: document.body?.innerText.slice(0, 4000) ?? ''
        };
      })()`,
      returnByValue: true,
    });
    lastState = response.result?.value;
    const ready = lastState?.readyState === 'complete' && lastState.tauriAvailable &&
      lastState.title === productName && lastState.rootChildren > 0 && lastState.workspaceVisible &&
      lastState.bodyText.length > 100;
    stable = ready ? stable + 1 : 0;
    if (events.some((event) => event.method === 'Runtime.exceptionThrown')) {
      throw new Error('The RushLink WebView reported an uncaught JavaScript exception. See cdp-events.json.');
    }
    if (stable >= 2) break;
    await pause(1000);
  }
  await save('page-state.json', lastState);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(output, 'webview.png'), Buffer.from(screenshot.data, 'base64'));
  if (stable < 2) throw new Error('Android launched RushLink, but its visible app content did not become ready.');
  if (profile) {
    const shortSide = Math.min(lastState.screen.width, lastState.screen.height);
    const expected = profile === 'phone' ? 1080 / (440 / 160) : 800;
    const expectedLayout = lastState.viewport.width < 600 ? 'phone' : 'tablet';
    if (Math.abs(shortSide - expected) > 2 || !lastState.layout?.includes(`app--${expectedLayout}`)) {
      throw new Error(`Unexpected ${profile} screen or app layout: ${JSON.stringify(lastState)}. See page-state.json.`);
    }
  }
  console.log(`RushLink is ready (${lastState.viewport.width}x${lastState.viewport.height}).`);
} catch (error) {
  await save('webview-error.json', { message: error.message, lastState });
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await save('cdp-events.json', events);
  for (const request of pending.values()) clearTimeout(request.timer);
  socket?.close();
}
