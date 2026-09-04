// Headrush Companion — background service worker

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const CANDIDATE_HOSTS = [
  'headrushprime.local',
  'headrushflexprime.local',
  'headrushcore.local',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function hr(method, host, path, body = null) {
  const url = `http://${host}/api/v1${path}`;
  try {
    const res = await fetch(url, {
      method,
      signal: AbortSignal.timeout(5000),
      headers: body !== null ? { 'Content-Type': 'application/json' } : {},
      body:    body !== null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401) {
        try {
          const json = JSON.parse(text);
          if (json.pairState) return [false, { _pairState: json.pairState, _pairPin: json.pairPin, _pairError: json.pairError }];
        } catch {}
      }
      return [false, { error: `HTTP ${res.status}` }];
    }
    return [true, text.trim() ? JSON.parse(text) : {}];
  } catch (e) {
    return [false, { error: e.message }];
  }
}

// POST /api/auth (not /api/v1) — initiates or polls pairing.
// Returns { pairState, pairPin, pairError }; pairState absent = paired.
async function pairDevice(host) {
  try {
    const res = await fetch(`http://${host}/api/auth`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const text = await res.text();
    const json = text.trim() ? JSON.parse(text) : {};
    return { pairState: json.pairState, pairPin: json.pairPin, pairError: json.pairError };
  } catch (e) {
    return { pairError: e.message };
  }
}

async function checkHost(host) {
  const [ok, data] = await hr('GET', host, '/object-properties/Evil/API/Blocks');
  if (ok) return { host, paired: true };
  if (data?._pairState) {
    const pair = await pairDevice(host);
    return { host, paired: false, pairPin: pair.pairPin };
  }
  return null;
}

// manualHost: when the 3 known .local hostnames don't resolve (e.g. mDNS
// blocked on the network), the popup lets the user type an IP address
// directly instead — checked in place of the candidate list, not in
// addition to it, since a manual attempt is always for one specific host.
async function discoverHost(manualHost) {
  const hosts = manualHost ? [manualHost] : CANDIDATE_HOSTS;
  for (const host of hosts) {
    const result = await checkHost(host);
    if (result) return result;
  }
  return null;
}

async function applyRig(blocks, rigName, host, pedal = [], switches = []) {
  const steps = [];
  const step  = (msg, ok = true) => steps.push({ msg, ok });

  const [okCat, deviceBlocks] = await hr('GET', host, '/object-properties/Evil/API/Blocks');
  if (!okCat) { step('Could not fetch ModuleTypes from device', false); return steps; }
  const moduleTypes = deviceBlocks.ModuleTypes || [];
  if (!moduleTypes.length) { step('ModuleTypes list is empty on device', false); return steps; }

  const lowerMap = {};
  for (const n of moduleTypes) lowerMap[n.toLowerCase()] = n;
  const canonical = name => moduleTypes.includes(name) ? name : (lowerMap[name.toLowerCase()] ?? null);

  const buildTypeMap = (strings) => Object.fromEntries((strings || []).map((n, i) => [n.toLowerCase(), i]));
  const metaCache = {};
  async function getBlockMeta(node) {
    if (metaCache[node]) return metaCache[node];
    const [ok, meta] = await hr('GET', host, `/object-meta/Evil/Engine/Patch/${node}`);
    metaCache[node] = (ok && meta) ? meta : {};
    return metaCache[node];
  }
  async function getOptMap(node, prop) {
    const meta = await getBlockMeta(node);
    return buildTypeMap(meta?.properties?.[prop]?.['x-options']?.strings);
  }
  const rvAmpTypeMap  = await getOptMap('ReValver_Amp', 'Type');
  const rvCabTypeMap  = await getOptMap('ReValver_Cab', 'CabType');
  const hrAmpTypeMap  = await getOptMap('Amp', 'Type');
  const hrCabTypeMap  = await getOptMap('Cab', 'CabType');

  await hr('POST', host, '/object-method/Evil/API/RigSaveDialog/discard', { arguments: [] });
  step('Discarded unsaved changes');
  await sleep(1500);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const slot  = i + 1;
    const canon = canonical(block.moduleId);
    if (!canon) { step(`Slot ${slot}: ${block.moduleId} — not found in device catalog`, false); continue; }

    if (canon !== block.moduleId) {
      block.moduleId = canon;
      block.nodePath = '/Evil/Engine/Patch/' + canon.replace(/ /g, '_');
    }

    if (block.presetName) {
      const key = block.presetName.toLowerCase();
      if (canon === 'ReValver Amp') {
        const idx = rvAmpTypeMap[key];
        if (idx !== undefined) block.settings = { ...block.settings, Type: idx };
      } else if (canon === 'ReValver Cab') {
        const idx = rvCabTypeMap[key];
        if (idx !== undefined) block.settings = { ...block.settings, CabType: idx };
      } else if (canon === 'Amp') {
        const idx = hrAmpTypeMap[key];
        if (idx !== undefined) block.settings = { ...block.settings, Type: idx };
      } else if (canon === 'Cab') {
        const idx = hrCabTypeMap[key];
        if (idx !== undefined) block.settings = { ...block.settings, CabType: idx };
      }
    }

    const modIdx = moduleTypes.indexOf(canon);
    const [ok, resp] = await hr('PUT', host, '/object-properties/Evil/Engine/Patch/Chain',
                                 { [`ModuleType${slot}`]: modIdx });
    step(`Slot ${slot}: ${canon}` + (ok ? '' : ` — ${resp.error ?? JSON.stringify(resp)}`), ok);
    await sleep(400);

    if (block.presetName && canon !== 'ReValver Amp' && canon !== 'ReValver Cab' && canon !== 'Amp' && canon !== 'Cab') {
      await hr('PUT', host, '/object-properties/Evil/Engine/Patch/CurrentBlock', { CurWebUIModule: i });
      const node = block.nodePath.split('/').pop();
      // C-Verb's factory presets (the only currently-populated non-amp/cab
      // presetName) load with the BARE preset name — the "+" prefix used
      // elsewhere in this codebase for amp/cab presets returns
      // methodReturnValue:false for it (confirmed live 2026-08-21). Keep the
      // "+" as the default for any other block type this ever applies to.
      const presetArg = canon === 'C-Verb' ? block.presetName : `+${block.presetName}`;
      const [okPreset, presetResp] = await hr('POST', host, '/object-method/Evil/API/Blocks/loadBlockPreset',
               { arguments: [node, presetArg, 0] });
      const loaded = okPreset && presetResp?.methodReturnValue === true;
      if (canon === 'C-Verb') {
        // Same reasoning as the NAM FileMissing check above: verify the
        // reverb file actually resolved rather than trusting the call.
        if (loaded) await sleep(500);
        const [okCheck, checkResp] = loaded ? await hr('GET', host, '/object-properties' + block.nodePath) : [false, null];
        const missing = loaded && okCheck && checkResp?.FileMissing;
        step(`  Preset: ${block.presetName}` + (loaded && !missing ? '' : ' — reverb file not found on device'), loaded && !missing);
      } else {
        step(`  Preset: ${block.presetName}` + (loaded ? '' : ' — preset failed to load'), loaded);
      }
      await sleep(300);
    }
  }

  const emptyIdx = moduleTypes.indexOf('Empty Slot');
  for (let slot = blocks.length + 1; slot < 15; slot++) {
    await hr('PUT', host, '/object-properties/Evil/Engine/Patch/Chain',
             { [`ModuleType${slot}`]: emptyIdx < 0 ? 0 : emptyIdx });
  }
  step('Signal chain placed');
  await sleep(500);

  // NAM A2: download a TONE3000 capture onto the device, then point the
  // block's LoadedClone at it — two separate steps (confirmed live
  // 2026-08-18 via the device's own file browser): downloadModelToDevice
  // only writes the file under "Neural Amp Modeler/Tone 3000/<filename>" on
  // the device filesystem (invisible to FileAccess/ls, which is stale/
  // unreliable for that folder — verify via the pedal's own UI, not ls, if
  // debugging), it does NOT wire up LoadedClone by itself. Argument order
  // (modelId, downloadUrl, filename) confirmed live — the reverse order
  // returns a real "HTTP 0" error without downloading anything.
  for (const block of blocks) {
    if (!block.namModelId || !block.namDownloadUrl) continue;
    const filename = block.namFilename || `${block.namModelId}.nam`;
    const [ok, resp] = await hr('POST', host, '/object-method/Evil/API/Tone3000/downloadModelToDevice', {
      arguments: [block.namModelId, block.namDownloadUrl, filename],
    });
    let parsed = null;
    try { parsed = ok ? JSON.parse(resp.methodReturnValue) : null; } catch {}
    const success = ok && parsed?.success;
    step(`NAM capture: ${block.namName || block.namModelId}` +
         (success ? '' : ` — ${parsed?.errorMessage || resp.error || 'download failed'}`), success);
    if (success) {
      await sleep(500); // give the device a moment to finish writing the file before selecting it
      const [okLoad, loadResp] = await hr('PUT', host, '/object-properties' + block.nodePath,
                                           { LoadedClone: `Neural Amp Modeler/Tone 3000/${filename}` });
      if (!okLoad) {
        step(`  Loaded into block — ${loadResp.error ?? JSON.stringify(loadResp)}`, false);
      } else {
        // namFilenameFor()'s sanitization is a best-effort match of an
        // undocumented on-device rule (see its comment in app.js) — verify
        // the file was actually found rather than trusting the PUT silently.
        // FileMissing lags the write by ~1s (confirmed live 2026-08-21).
        await sleep(800);
        const [okCheck, checkResp] = await hr('GET', host, '/object-properties' + block.nodePath);
        const missing = okCheck && checkResp?.FileMissing;
        step(`  Loaded into block` + (missing ? ` — file not found on device (filename sanitization mismatch — see namFilenameFor)` : ''), !missing);
      }
    }
  }

  const ALIASES = {
    'mic axis': 'onaxis', 'on axis': 'onaxis',
    'output level': 'trim', 'master volume': 'master',
    'lo cut': 'locut', 'hi cut': 'hicut',
  };

  for (const block of blocks) {
    const settings = block.settings;
    if (!settings || !Object.keys(settings).length) continue;

    const [okGet, current] = await hr('GET', host, '/object-properties' + block.nodePath);
    if (!okGet) { step(`Params: ${block.moduleId} — could not read properties`, false); continue; }

    const excluded  = new Set(['order', 'labels', 'disabled']);
    const validKeys = new Set(Object.keys(current).filter(k => !excluded.has(k)));
    const lowerValid = {};
    for (const k of validKeys) lowerValid[k.toLowerCase()] = k;

    const labelMap = {};
    (current.labels || []).forEach((lbl, j) => {
      if (lbl && current.order?.[j]) {
        const ll = lbl.toLowerCase();
        if (!labelMap[ll]) labelMap[ll] = current.order[j];
      }
    });

    const blockNode = block.nodePath.split('/').pop();
    const blockMeta = await getBlockMeta(blockNode);

    const filtered = {};
    for (const [k, v] of Object.entries(settings)) {
      const kl = k.toLowerCase();
      const alias = ALIASES[kl];
      const ck = lowerValid[kl] ?? labelMap[kl] ?? (alias ? lowerValid[alias] : null);
      if (!ck || !validKeys.has(ck)) continue;
      let val = v;
      const propType = blockMeta?.properties?.[ck]?.type;
      if (typeof val === 'string') {
        if (propType === 'boolean') {
          // Some params that look like Off/On enums (Tails, Hiss, Gate, ...)
          // are actually plain booleans on the device (no x-options.strings
          // list at all) — writing the raw string there is silently ignored/
          // coerced falsy instead of erroring, which is why generated rigs
          // showed "Tails: On" in the UI but landed Off on the pedal.
          // Confirmed live 2026-08-19 (Shimmer/Dyn Delay's Tails is type
          // "boolean", x-options only has {default:false}, no strings list).
          val = /^(on|true|yes)$/i.test(val.trim());
        } else {
          const opts = blockMeta?.properties?.[ck]?.['x-options']?.strings;
          if (opts) {
            const idx = opts.findIndex(o => o.toLowerCase() === val.toLowerCase());
            if (idx >= 0) val = idx;
          }
        }
      }
      filtered[ck] = val;
    }

    if (!Object.keys(filtered).length) { step(`Params: ${block.moduleId} — no matching params`); continue; }

    const [ok, resp] = await hr('PUT', host, '/object-properties' + block.nodePath, filtered);
    step(`Params: ${block.moduleId} (${Object.keys(filtered).length} props)` +
         (ok ? '' : ` — ${resp.error ?? JSON.stringify(resp)}`), ok);
    await sleep(100);
  }

  // Footswitch / expression pedal assignment (see app.js's
  // planFootswitchAssignment — pedal/switches were already computed there
  // from the same blocks/slot names, this just writes them to the device).
  // Live paths are siblings of Patch (/Evil/Engine/FootSwitch,
  // /Evil/Engine/Pedal1), not under it — confirmed against a real Prime
  // 2026-08-12, field names match the .rig file format exactly except
  // ModeNew, which is an integer enum live (string in the file).
  const [okFsMeta, fsMeta] = await hr('GET', host, '/object-meta/Evil/Engine/FootSwitch');
  const modeOptions = okFsMeta ? (fsMeta?.properties?.ModeNew1?.['x-options']?.strings || []) : [];
  const toggleIdx = Math.max(0, modeOptions.findIndex(o => o.toLowerCase() === 'toggle'));

  const fsBody = {};
  for (let n = 1; n <= 8; n++) {
    const assign = switches[n - 1];
    fsBody[`Module${n}`] = assign ? assign.module : 'Unassigned';
    fsBody[`Operation${n}`] = assign ? 'On' : '';
    fsBody[`ModeNew${n}`] = toggleIdx;
    fsBody[`UserFootSwitchText${n}`] = '';
  }
  const [okFs, fsResp] = await hr('PUT', host, '/object-properties/Evil/Engine/FootSwitch', fsBody);
  step('Footswitch assignment' + (okFs ? '' : ` — ${fsResp.error ?? JSON.stringify(fsResp)}`), okFs);

  const pedalBody = {};
  for (let n = 1; n <= 4; n++) {
    const assign = pedal[n - 1];
    pedalBody[`Module${n}`] = assign ? assign.module : 'Unassigned';
    pedalBody[`Param${n}`] = assign ? assign.param : '';
  }
  const [okPedal, pedalResp] = await hr('PUT', host, '/object-properties/Evil/Engine/Pedal1', pedalBody);
  step('Expression pedal assignment' + (okPedal ? '' : ` — ${pedalResp.error ?? JSON.stringify(pedalResp)}`), okPedal);

  return steps;
}

// ── Log to storage (popup listens via onChanged) ─────────────────────────────

async function appendLogs(entries) {
  const { sendLogs = [] } = await chrome.storage.local.get('sendLogs');
  const next = [...sendLogs, ...entries].slice(-200);
  await chrome.storage.local.set({ sendLogs: next });
}

// ── Setlist/rig data via REST ─────────────────────────────────────────────────

// hr() returns { methodReturnValue: "<json string>" } for POST /object-method calls.
// getSetlist double-encodes the inner JSON (per bundle: lf.parse(JSON.parse(e))).
function parseGetSetlistResponse(raw) {
  try {
    const returnVal = (raw && typeof raw === 'object' && 'methodReturnValue' in raw)
      ? raw.methodReturnValue
      : raw;
    const once = typeof returnVal === 'string' ? JSON.parse(returnVal) : returnVal;
    const data  = typeof once    === 'string' ? JSON.parse(once)      : once;
    return data;
  } catch {
    return null;
  }
}

// Fetches master tempo (Evil/Engine/Tempo) and rig tempo info (Patch/Rig) in parallel.
// bpm    = master tempo — always stable, used for global display
// rigBpm = rig's own fixed BPM (only when TempoFromMaster=false), used for per-rig badge
async function fetchTempoInfo(host) {
  const [[rigOk, rigD], [masterOk, masterD]] = await Promise.all([
    hr('GET', host, '/object-properties/Evil/Engine/Patch/Rig'),
    hr('GET', host, '/object-properties/Evil/Engine/Tempo'),
  ]);
  const fromMaster = !rigOk || !!rigD.TempoFromMaster;
  const masterBpm  = masterOk && masterD?.Tempo !== undefined
    ? Math.round(30 + masterD.Tempo * 210) : null;
  const rigBpm     = !fromMaster && rigOk && rigD?.Tempo !== undefined
    ? Math.round(30 + rigD.Tempo * 210) : null;
  return { bpm: masterBpm, fromMaster, rigBpm };
}

async function fetchTempo(host) {
  const info = await fetchTempoInfo(host);
  return info.bpm;
}


function rigsFromSetlistData(data) {
  if (!data) return [];
  if (Array.isArray(data.songs) && data.songs.length) {
    return data.songs.flatMap(song => song.rig_names || song.rigs || []);
  }
  return data.rig_names || data.rigs || [];
}

async function fetchRigSrIdMap(host) {
  const [ok, props] = await hr('GET', host, '/object-properties/Evil/API/Rigs');
  const map = {};
  if (ok && props) {
    const ids  = Array.isArray(props.RigIds)   ? props.RigIds   : [];
    const sids = Array.isArray(props.RigSrIds) ? props.RigSrIds : [];
    ids.forEach((id, i) => { if (id) map[id] = sids[i] || ''; });
  }
  return map;
}

async function scrapeViaRest(host) {
  // GET /object-properties/Evil/API/Setlists → SetlistIds[] + SetlistNames[]
  const [slOk, slProps] = await hr('GET', host, '/object-properties/Evil/API/Setlists');
  if (!slOk) {
    if (slProps?._pairState) {
      // Device requires PIN authorization — initiate pairing to get PIN
      const pair = await pairDevice(host);
      return { _needsPairing: true, pairPin: pair.pairPin || slProps._pairPin };
    }
    return null;
  }
  if (!slProps) return null;

  const setlistIds   = slProps.SetlistIds   || slProps.setlistIds   || [];
  const setlistNames = slProps.SetlistNames || slProps.setlistNames || [];
  const loadedId     = slProps.loadedID     || slProps.loadedId     || null;

  if (!setlistIds.length && !setlistNames.length) return null;

  const setlists = setlistIds.map((id, i) => ({ id, name: setlistNames[i] || id }));
  if (!setlists.length) setlistNames.forEach(n => setlists.push({ id: n, name: n }));

  const currentSet = loadedId ? Math.max(0, setlists.findIndex(s => s.id === loadedId)) : 0;

  // Fetch song/rig data for each setlist + tempo + current setlist's srIds in parallel
  const [setlistData, tempo, srIdMap] = await Promise.all([
    Promise.all(setlists.map(async ({ id, name }) => {
      const [ok, raw] = await hr('POST', host, '/object-method/Evil/API/Setlists/getSetlist', { arguments: [id] });
      const data = ok ? parseGetSetlistResponse(raw) : null;
      return { id, name, data };
    })),
    fetchTempo(host),
    fetchRigSrIdMap(host),
  ]);

  const rigNames = rigsFromSetlistData(setlistData[currentSet]?.data);

  return {
    setlistNames: setlists.map(s => s.name),
    currentSet,
    rigNames,
    activeIdx: -1,
    setlistData,
    tempo,
    srIdMap,
    _source: 'rest',
  };
}

// ── Message handlers ──────────────────────────────────────────────────────────
// HR_DISCOVER and HR_PAIR are handled identically from both the extension's own
// popup (onMessage) and web pages (onMessageExternal) — shared here so a future
// fix to one doesn't miss the other. The one deliberate difference: onMessage
// forwards msg.host (popup's manual-IP entry), onMessageExternal never does —
// external web pages can't direct a discover at an arbitrary host.

function handleDiscoverRequest(hostArg, sendResponse) {
  discoverHost(hostArg).then(result => {
    if (!result) { sendResponse({ found: false }); return; }
    sendResponse(result.paired
      ? { found: true, host: result.host }
      : { found: true, host: result.host, needsPairing: true, pairPin: result.pairPin });
  });
}

function handlePairRequest(host, sendResponse) {
  (async () => {
    const [ok, data] = await hr('GET', host, '/object-properties/Evil/API/Setlists');
    if (ok) {
      sendResponse({ paired: true });
    } else if (data?._pairState) {
      sendResponse({ paired: false, pairState: data._pairState, pairPin: data._pairPin });
    } else {
      sendResponse({ paired: false });
    }
  })();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'HR_DISCOVER') {
    handleDiscoverRequest(msg.host, sendResponse);
    return true;
  }
  if (msg.type === 'HR_PAIR') {
    handlePairRequest(msg.host, sendResponse);
    return true;
  }
});

chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'HR_DISCOVER') {
    handleDiscoverRequest(undefined, sendResponse);
    return true;
  }
  if (msg.type === 'HR_SEND') {
    const ts = () => new Date().toISOString();
    appendLogs([{ ts: ts(), msg: `Sending rig: ${msg.rigName}`, type: 'info' }]);
    applyRig(msg.blocks, msg.rigName, msg.host, msg.pedal, msg.switches).then(steps => {
      const ok = steps.every(s => s.ok);
      const entries = steps.map(s => ({ ts: ts(), msg: '  ' + s.msg, type: s.ok ? 'info' : 'error' }));
      entries.push({ ts: ts(), msg: ok ? `✓ Done — ${msg.rigName}` : `✕ Failed — ${msg.rigName}`, type: ok ? 'success' : 'error' });
      appendLogs(entries);
      sendResponse({ ok, steps });
    });
    return true;
  }
  if (msg.type === 'HR_GET_HOST') {
    chrome.storage.local.get('host', data => sendResponse({ host: data.host || null }));
    return true;
  }
  if (msg.type === 'HR_PAIR') {
    handlePairRequest(msg.host, sendResponse);
    return true;
  }
  if (msg.type === 'HR_SCRAPE') {
    (async () => {
      const ts = () => new Date().toISOString();
      try {
        const data = await scrapeViaRest(msg.host);
        if (data?._needsPairing) {
          sendResponse({ ok: false, needsPairing: true, pairPin: data.pairPin });
        } else if (data) {
          appendLogs([{ ts: ts(), msg: `Loaded ${data.setlistNames?.length ?? 0} setlists`, type: 'info' }]);
          sendResponse({ ok: true, data });
        } else {
          appendLogs([{ ts: ts(), msg: 'Could not read setlists from device', type: 'error' }]);
          sendResponse({ ok: false, data: null });
        }
      } catch (e) {
        appendLogs([{ ts: new Date().toISOString(), msg: `HR_SCRAPE error: ${e.message}`, type: 'error' }]);
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }
  if (msg.type === 'HR_SET_TEMPO') {
    (async () => {
      const ts = new Date().toISOString();
      const { host, bpm } = msg;
      const normalized = (bpm - 30) / (240 - 30);
      const [ok] = await hr('PUT', host, '/object-properties/Evil/Engine/Tempo',
                             { Tempo: normalized });
      appendLogs([{ ts, msg: ok ? `Tempo → ${bpm} BPM` : `Tempo failed (${bpm} BPM)`, type: ok ? 'info' : 'error' }]);
      sendResponse({ ok });
    })();
    return true;
  }
  if (msg.type === 'HR_DRUM_LOAD') {
    (async () => {
      const ts = new Date().toISOString();
      try {
        const { host } = msg;

        // Notify device that the drums page is open so it tracks state
        await hr('POST', host, '/object-method/Evil/Engine/DrumsCtrl/drumsPageOpened', { arguments: [] });

        // Fetch props + presets + metadata + tempo in parallel
        const [[propsOk, props], [presetsOk, presetsRaw], [, meta], tempo] = await Promise.all([
          hr('GET', host, '/object-properties/Evil/Engine/DrumsCtrl'),
          hr('POST', host, '/object-method/Evil/Engine/DrumsCtrl/presets', { arguments: [] }),
          hr('GET', host, '/object-meta/Evil/Engine/DrumsCtrl'),
          fetchTempo(host),
        ]);

        if (!propsOk) {
          if (props?._pairState) {
            const pair = await pairDevice(host);
            sendResponse({ ok: false, needsPairing: true, pairPin: pair.pairPin || props._pairPin });
          } else {
            sendResponse({ ok: false, error: props?.error || 'Could not read DrumsCtrl' });
          }
          return;
        }

        // presets() returns { methodReturnValue: <array or json string> }
        let presetList = [];
        if (presetsOk && presetsRaw) {
          try {
            const returnVal = presetsRaw.methodReturnValue ?? presetsRaw;
            const once = typeof returnVal === 'string' ? JSON.parse(returnVal) : returnVal;
            const data  = typeof once     === 'string' ? JSON.parse(once)     : once;
            if (Array.isArray(data)) presetList = data;
            else if (Array.isArray(data?.presets)) presetList = data.presets;
          } catch {}
        }

        // StyleList in props = selected category (string). Available categories come from metadata.
        const categoryList = meta?.properties?.StyleList?.['x-options']?.strings ?? [];
        const grooveList   = meta?.properties?.Groove?.['x-options']?.strings ?? [];

        appendLogs([{ ts, msg: `Drums loaded — ${presetList.length} presets`, type: 'info' }]);
        sendResponse({
          ok: true,
          data: {
            isPlaying:    !!props.isPlaying,
            isMuted:      !!props.isMuted,
            kit:          props.Kit          || null,
            kitList:      Array.isArray(props.KitList)      ? props.KitList      : [],
            // StyleList and Groove are integer indices on the device (type "integer" in metadata)
            categoryIdx:  typeof props.StyleList === 'number' ? props.StyleList : -1,
            categoryList,
            styleVariList:Array.isArray(props.StyleVariList)? props.StyleVariList: [],
            styleVari:    props.StyleVari    || null,
            intensity:    props.Intensity    ?? null,
            grooveDepth:  props.GrooveDepth  ?? null,
            grooveIdx:    typeof props.Groove === 'number' ? props.Groove : -1,
            grooveList,
            loadedPreset: props.LoadedPreset || null,
            partInfo:     props.PartInfo     || null,
            presets:      presetList,
            tempo,
          },
        });
      } catch (e) {
        appendLogs([{ ts: new Date().toISOString(), msg: `HR_DRUM_LOAD error: ${e.message}`, type: 'error' }]);
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }
  if (msg.type === 'HR_DRUM_SET') {
    (async () => {
      const { host, props } = msg;
      const [ok] = await hr('PUT', host, '/object-properties/Evil/Engine/DrumsCtrl', props);
      const key = Object.keys(props)[0] || '?';
      appendLogs([{ ts: new Date().toISOString(), msg: ok ? `Drums ${key} → ${props[key]}` : `Drums SET failed (${key})`, type: ok ? 'info' : 'error' }]);
      sendResponse({ ok });
    })();
    return true;
  }
  if (msg.type === 'HR_GET_TEMPO') {
    (async () => {
      const [ok, data] = await hr('GET', msg.host, '/object-properties/Evil/Engine/Tempo');
      const bpm = ok && data?.Tempo !== undefined ? Math.round(30 + data.Tempo * 210) : null;
      sendResponse({ bpm });
    })();
    return true;
  }
  if (msg.type === 'HR_DRUM_GET_PROPS') {
    (async () => {
      const [[ok, props], tempo] = await Promise.all([
        hr('GET', msg.host, '/object-properties/Evil/Engine/DrumsCtrl'),
        fetchTempo(msg.host),
      ]);
      sendResponse({ ok, props: ok ? props : null, tempo });
    })();
    return true;
  }
  if (msg.type === 'HR_DRUM_METHOD') {
    (async () => {
      const { host, method, args } = msg;
      const [ok, data] = await hr('POST', host, `/object-method/Evil/Engine/DrumsCtrl/${method}`, { arguments: args || [] });
      appendLogs([{ ts: new Date().toISOString(), msg: ok ? `Drums ${method}()` : `Drums ${method}() failed`, type: ok ? 'info' : 'error' }]);
      sendResponse({ ok, data });
    })();
    return true;
  }
  if (msg.type === 'HR_NAM_SEARCH') {
    (async () => {
      const { host, query, filters } = msg;
      // filters shape confirmed live 2026-08-19 by hooking fetch() in the
      // pedal's own Cloud > TONE3000 browse UI: { architecture: 1|2,
      // calibrated: bool, gear: ["amp"|"full-rig"], sizes: [] }. gear: []
      // means unrestricted (both Amp Head and Full Rig/Combo).
      const body = { query, filters: filters || { architecture: 2, calibrated: false, gear: [], sizes: [] }, page: 1, pageSize: 25, sortMode: 0, feedMode: 'browse' };
      const [ok, resp] = await hr('POST', host, '/object-method/Evil/API/Tone3000/searchTones', {
        arguments: [JSON.stringify(body)],
      });
      let parsed = null;
      try { parsed = ok ? JSON.parse(resp.methodReturnValue) : null; } catch {}
      // searchTones returns { result: { page, page_size, tones: [...] } } —
      // each "tone" is a capture pack (may hold several downloadable models,
      // split by architecture — see HR_NAM_MODELS) with its own `gear`
      // ("amp" = Amp Head, "amp-cab" = Full Rig/Combo) — confirmed live
      // against a real Prime 2026-08-18/19.
      sendResponse({ ok: ok && !!parsed, results: parsed?.result?.tones || [] });
    })();
    return true;
  }
  if (msg.type === 'HR_NAM_MODELS') {
    (async () => {
      const { host, toneId, architecture } = msg;
      // architecture: 2 = NAM A2 (preferred), 1 = NAM A1 (legacy) — the
      // pedal's own UI calls fetchModels once per architecture to build its
      // "NAM A2" / "NAM A1 (legacy)" sections; confirmed live 2026-08-19.
      const [ok, resp] = await hr('POST', host, '/object-method/Evil/API/Tone3000/fetchModels', {
        arguments: [JSON.stringify({ toneId, architecture: architecture || 2 })],
      });
      let parsed = null;
      try { parsed = ok ? JSON.parse(resp.methodReturnValue) : null; } catch {}
      sendResponse({ ok: ok && !!parsed, results: parsed?.result || parsed?.results || [] });
    })();
    return true;
  }
  if (msg.type === 'HR_CLICK_RIG') {
    (async () => {
      const ts = () => new Date().toISOString();
      try {
        const { host, setlistId, rigIndex, rigId, srId } = msg;

        // Switch setlist only (no specific rig) — also fetch srId map for new setlist
        if (rigIndex < 0 && setlistId) {
          await hr('POST', host, '/object-method/Evil/API/Setlists/loadSetlist',
                   { arguments: [setlistId, true] });
          await sleep(1000);           // wait for device to update RigIds/RigSrIds
          const [srIdMap, rigTempo] = await Promise.all([
            fetchRigSrIdMap(host),
            fetchTempoInfo(host),
          ]);
          appendLogs([{ ts: ts(), msg: `Setlist loaded`, type: 'info' }]);
          sendResponse({ ok: true, srIdMap, tempo: rigTempo.bpm, rigTempo });
          return;
        }

        // Activate rig — srId from setlist view enables bank/position tracking on hardware
        if (rigId) {
          const [ok] = await hr('POST', host, '/object-method/Evil/API/Rigs/loadRigConfirm',
                                 { arguments: [rigId, srId || ''] });
          let info = null;
          if (ok) {
            await sleep(600);          // wait for device to finish loading the rig
            info = await fetchTempoInfo(host);
          }
          const rigLabel = msg.rigName || `Rig ${(msg.rigIndex ?? 0) + 1}`;
          appendLogs([{ ts: ts(), msg: ok ? `✓ ${rigLabel}` : `✕ Could not load ${rigLabel}`, type: ok ? 'success' : 'error' }]);
          sendResponse({ ok, tempo: info?.bpm ?? null, rigTempo: info });
          return;
        }

        sendResponse({ ok: false, error: 'No rigId provided' });
      } catch (e) {
        appendLogs([{ ts: new Date().toISOString(), msg: `HR_CLICK_RIG error: ${e.message}`, type: 'error' }]);
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }
});
