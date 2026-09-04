const dot        = document.getElementById('dot');
const statusText = document.getElementById('status-text');
const statusSub  = document.getElementById('status-sub');
const connectBtn = document.getElementById('connect-btn');
const logContainer = document.getElementById('log-container');
const clearBtn   = document.getElementById('clear-btn');
const manualIpBox   = document.getElementById('manual-ip');
const ipInput        = document.getElementById('ip-input');
const ipConnectBtn   = document.getElementById('ip-connect-btn');
const pairCancelBtn  = document.getElementById('pair-cancel-btn');

function setManualIpVisible(visible) { manualIpBox.style.display = visible ? 'block' : 'none'; }

function setStatus(state, text, sub = '') {
  dot.className = 'status-dot ' + state;
  statusText.textContent = text;
  statusSub.textContent  = sub;
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderLogEntry(time, msg, type) {
  const el = document.createElement('div');
  el.className = 'log-entry ' + type;
  const timeEl = document.createElement('span');
  timeEl.className = 'log-time';
  timeEl.textContent = time;
  el.appendChild(timeEl);
  el.appendChild(document.createTextNode(msg));
  logContainer.appendChild(el);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function log(msg, type = 'info') { renderLogEntry(fmtTime(Date.now()), msg, type); }
function appendLog(entry) { renderLogEntry(fmtTime(entry.ts), entry.msg, entry.type); }

clearBtn.addEventListener('click', () => {
  logContainer.innerHTML = '';
  chrome.storage.local.remove('sendLogs');
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.sendLogs) return;
  const prev = changes.sendLogs.oldValue || [];
  const next = changes.sendLogs.newValue || [];
  next.slice(prev.length).forEach(appendLog);
});

// ── Pairing poll ──────────────────────────────────────────────────────────────

let pairTimer = null;

function stopPairPoll() {
  clearInterval(pairTimer);
  pairTimer = null;
}

function setPairingCancelVisible(visible) { pairCancelBtn.style.display = visible ? 'block' : 'none'; }

function startPairPoll(host, pin) {
  stopPairPoll();
  const pinLabel = (pin || '????').toUpperCase();
  setStatus('checking', 'Authorize on device', 'PIN: ' + pinLabel);
  log('PIN: ' + pinLabel + ' — confirm on device', 'info');
  setPairingCancelVisible(true);
  pairTimer = setInterval(async () => {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'HR_PAIR', host });
      if (resp && resp.paired) {
        stopPairPoll();
        setPairingCancelVisible(false);
        chrome.storage.local.set({ host });
        setStatus('connected', 'Connected', host);
        log('Paired and connected: ' + host, 'success');
      }
    } catch (e) {
      log('Poll error: ' + e.message, 'error');
    }
  }, 2000);
}

pairCancelBtn.addEventListener('click', () => {
  stopPairPoll();
  setPairingCancelVisible(false);
  setStatus('disconnected', 'Pairing cancelled', 'Click Connect to try again');
  log('Pairing cancelled');
});

// ── Connect / disconnect ──────────────────────────────────────────────────────

function notFound(title, sub, msg) {
  setStatus('disconnected', title, sub);
  log(msg, 'error');
  // Only shown once the 3 known .local hostnames have all failed — mDNS
  // is sometimes blocked on guest/corporate Wi-Fi, so a direct IP is the
  // fallback (see discoverHost() in background.js).
  setManualIpVisible(true);
}

function handleDiscoverResult(res) {
  if (res.found && !res.needsPairing) {
    chrome.storage.local.set({ host: res.host });
    setStatus('connected', 'Connected', res.host);
    log('Found: ' + res.host, 'success');
    setManualIpVisible(false);
  } else if (res.found && res.needsPairing) {
    startPairPoll(res.host, res.pairPin);
    setManualIpVisible(false);
  } else {
    notFound('Not found', 'Make sure pedal is on same Wi-Fi', 'No Headrush pedal found on network');
  }
}

async function connect() {
  stopPairPoll();
  setPairingCancelVisible(false);
  setManualIpVisible(false);
  setStatus('checking', 'Searching…', 'Scanning local network');
  log('Discovering pedal…');
  connectBtn.disabled = true;
  const res = await chrome.runtime.sendMessage({ type: 'HR_DISCOVER' });
  connectBtn.disabled = false;
  handleDiscoverResult(res);
}

connectBtn.addEventListener('click', connect);

async function connectManualIp() {
  const ip = ipInput.value.trim();
  if (!ip) return;
  stopPairPoll();
  setPairingCancelVisible(false);
  setStatus('checking', 'Connecting…', ip);
  log('Trying ' + ip + '…');
  ipConnectBtn.disabled = true;
  const res = await chrome.runtime.sendMessage({ type: 'HR_DISCOVER', host: ip });
  ipConnectBtn.disabled = false;
  if (!res.found) {
    notFound('Not found', 'Check the IP address and try again', 'No pedal responded at ' + ip);
    return;
  }
  handleDiscoverResult(res);
}

ipConnectBtn.addEventListener('click', connectManualIp);
ipInput.addEventListener('keydown', e => { if (e.key === 'Enter') connectManualIp(); });

document.getElementById('disconnect-btn').addEventListener('click', () => {
  if (!confirm('Disconnect from pedal?')) return;
  stopPairPoll();
  setPairingCancelVisible(false);
  chrome.storage.local.remove('host');
  setStatus('disconnected', 'Disconnected', 'Click Connect to find your pedal');
  log('Disconnected');
});

document.getElementById('manual-ip-link').addEventListener('click', () => {
  setManualIpVisible(true);
  ipInput.focus();
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  const { host, sendLogs = [] } = await chrome.storage.local.get(['host', 'sendLogs']);
  logContainer.innerHTML = '';
  sendLogs.forEach(appendLog);
  if (!sendLogs.length) {
    logContainer.innerHTML = '<div class="log-entry info"><span class="log-time">—</span>Ready</div>';
  }
  if (host) {
    setStatus('checking', 'Checking…', host);
    const res = await chrome.runtime.sendMessage({ type: 'HR_DISCOVER' });
    if (res.found && !res.needsPairing) {
      setStatus('connected', 'Connected', res.host);
      log('Pedal online: ' + res.host, 'success');
    } else if (res.found && res.needsPairing) {
      startPairPoll(res.host, res.pairPin);
    } else {
      notFound('Not reachable', host, 'Pedal not reachable');
    }
  } else {
    setStatus('disconnected', 'Not connected', 'Click Connect to find your pedal');
  }
})();
