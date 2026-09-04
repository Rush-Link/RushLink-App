'use strict';

const fs = require('fs');
const path = require('path');

const workspace = path.resolve(__dirname, '..');
const outputFile = path.join(workspace, 'reference/headrush/route-discovery.json');
const baseUrl = process.env.HEADRUSH_BASE_URL || 'http://192.168.1.129';
const hostHeader = process.env.HEADRUSH_HOST || 'headrushflexprime.local';

const commonDocuments = [
  'api', 'api/', 'api/v1', 'api/v1/', 'api/v2', 'api/v2/', 'docs', 'api/docs', 'api/v1/docs',
  'swagger', 'swagger/', 'swagger.json', 'swagger.yaml', 'swagger-ui', 'swagger-ui.html',
  'openapi', 'openapi.json', 'openapi.yaml', 'api/openapi.json', 'api/v1/openapi.json',
  'api-docs', 'v1/api-docs', 'v2/api-docs', 'v3/api-docs', 'redoc', 'rapidoc',
  '.well-known/openapi.json', '.well-known/security.txt', '.well-known/assetlinks.json',
  'graphql', 'graphiql', 'api/graphql', 'rpc', 'jsonrpc',
];
const diagnostics = [
  'health', 'healthz', 'ready', 'readyz', 'live', 'livez', 'status', 'info', 'version', 'build',
  'ping', 'metrics', 'prometheus', 'debug', 'debug/', 'debug/pprof', 'logs', 'log', 'trace',
  'api/health', 'api/healthz', 'api/status', 'api/info', 'api/version', 'api/build',
  'api/v1/health', 'api/v1/healthz', 'api/v1/status', 'api/v1/info', 'api/v1/version',
  'system', 'device', 'config', 'configuration', 'settings', 'capabilities', 'features',
];
const apiNouns = [
  'objects', 'object', 'meta', 'metadata', 'properties', 'property', 'methods', 'method',
  'tree', 'subtree', 'schema', 'schemas', 'reflection', 'reflect', 'model', 'data-model',
  'events', 'event', 'notifications', 'subscribe', 'subscriptions', 'watch', 'stream',
  'websocket', 'ws', 'socket', 'sessions', 'session', 'auth', 'pair', 'pairing',
  'files', 'file', 'assets', 'images', 'blocks', 'rigs', 'setlists', 'presets', 'cloud',
  'upload', 'download', 'export', 'import', 'backup', 'restore', 'device', 'system', 'settings',
];
const staticPaths = [
  'favicon.ico', 'robots.txt', 'sitemap.xml', 'manifest.json', 'asset-manifest.json',
  'service-worker.js', 'sw.js', 'precache-manifest.js', 'version.json', 'build.json',
  'static', 'static/', 'static/js', 'static/js/', 'static/css', 'static/css/', 'static/media', 'static/media/',
  'files', 'files/', 'files/Evil', 'files/Evil/', 'files/Evil/Web', 'files/Evil/Web/',
  'files/Evil/Web/Blocks', 'files/Evil/Web/Blocks/', 'files/Evil/Web/Blocks/img', 'files/Evil/Web/Blocks/img/',
];
const objectNames = [
  'About', 'App', 'Application', 'Audio', 'AudioCtrl', 'Backup', 'Bluetooth', 'Capabilities',
  'Cloud', 'Config', 'Configuration', 'Control', 'Controller', 'Database', 'Debug', 'Device',
  'Diagnostics', 'Display', 'Editor', 'Engine', 'Events', 'Factory', 'Features', 'FileSystem',
  'Firmware', 'Global', 'Hardware', 'Info', 'License', 'Licenses', 'Logs', 'Master', 'Network',
  'Notifications', 'Pairing', 'Power', 'Presets', 'Profile', 'Remote', 'Root', 'Session', 'Settings',
  'Status', 'Storage', 'System', 'Telemetry', 'Update', 'Updater', 'USB', 'User', 'Version', 'Web', 'WiFi',
];

const candidates = new Set([
  ...commonDocuments, ...diagnostics, ...staticPaths,
  ...apiNouns.map((name) => `api/v1/${name}`),
  ...apiNouns.map((name) => `api/${name}`),
  'api/v1/subtree/Evil', 'api/v1/subtree/Evil/API', 'api/v1/subtree/Evil/Cloud',
  'api/v1/subtree/Evil/Engine', 'api/v1/subtree/Evil/Engine/Patch', 'api/v1/subtree/Evil/Engine/Settings',
  ...objectNames.flatMap((name) => [
    `api/v1/object-meta/Evil/${name}`,
    `api/v1/object-meta/Evil/API/${name}`,
    `api/v1/object-meta/Evil/Engine/${name}`,
    `api/v1/object-meta/Evil/Engine/Settings/${name}`,
  ]),
]);

async function probe(candidate) {
  const pathname = `/${candidate}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers: { Host: hostHeader, Accept: '*/*' },
      signal: controller.signal,
    });
    const body = Buffer.from(await response.arrayBuffer());
    const preview = body.subarray(0, 240).toString('utf8').replace(/\s+/g, ' ').trim();
    return {
      path: pathname,
      status: response.status,
      contentType: response.headers.get('content-type'),
      bytes: body.length,
      preview,
    };
  } catch (error) {
    return { path: pathname, error: error.name || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimited(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  return results;
}

async function main() {
  const results = await mapLimited([...candidates].sort(), 12, probe);
  const generic404 = results.filter((item) => item.status === 404 && item.bytes === 67).length;
  const recognizedHandler404 = results.filter((item) => item.status === 404 && /DataModel: (?:Object|Client|Path) not found/.test(item.preview || ''));
  const confirmed = results.filter((item) => item.status >= 200 && item.status < 300);
  const interesting = results.filter((item) => item.error || (item.status !== 404 && !(item.status >= 200 && item.status < 300)));
  const report = {
    capturedAt: new Date().toISOString(), baseUrl, candidateCount: results.length,
    generic404Count: generic404,
    recognizedHandler404Count: recognizedHandler404.length,
    confirmedCount: confirmed.length,
    confirmed,
    interestingCount: interesting.length,
    interesting,
    results,
  };
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    candidateCount: report.candidateCount,
    generic404Count: report.generic404Count,
    recognizedHandler404Count: report.recognizedHandler404Count,
    confirmedCount: report.confirmedCount,
    confirmed,
    interestingCount: report.interestingCount,
    interesting,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
