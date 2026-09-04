'use strict';

const fs = require('fs');
const path = require('path');

const workspace = path.resolve(__dirname, '..');
const outputDirectory = path.join(workspace, 'reference/headrush/raw/web-root-mirror');
const reportFile = path.join(workspace, 'reference/headrush/web-file-crawl.json');
const baseUrl = process.env.HEADRUSH_BASE_URL || 'http://192.168.1.129';
const hostHeader = process.env.HEADRUSH_HOST || 'headrushflexprime.local';
const roots = ['/static', '/files/Evil/Web'];

const entries = [];
const visited = new Set();

async function get(route) {
  const response = await fetch(`${baseUrl}${route}`, { headers: { Host: hostHeader } });
  return { response, data: Buffer.from(await response.arrayBuffer()) };
}

function localPath(route) {
  const clean = route.replace(/^\//, '').split('/').map((part) => decodeURIComponent(part));
  return path.join(outputDirectory, ...clean);
}

async function crawlDirectory(route) {
  if (visited.has(route)) return;
  visited.add(route);
  const { response, data } = await get(route);
  if (!response.ok) {
    entries.push({ route, kind: 'directory', status: response.status });
    return;
  }
  let listing;
  try { listing = JSON.parse(data.toString('utf8')); } catch { listing = null; }
  if (!Array.isArray(listing)) {
    entries.push({ route, kind: 'directory', status: response.status, error: 'Response was not a directory listing' });
    return;
  }
  entries.push({ route, kind: 'directory', status: response.status, entryCount: listing.length });
  for (const item of listing) {
    const childRoute = `${route}/${encodeURIComponent(item.name)}`;
    if (item.type === 2) {
      await crawlDirectory(childRoute);
    } else if (item.type === 1) {
      const file = await get(childRoute);
      const destination = localPath(`${route}/${item.name}`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (file.response.ok) fs.writeFileSync(destination, file.data);
      entries.push({
        route: childRoute, kind: 'file', status: file.response.status,
        listedBytes: item.size, downloadedBytes: file.response.ok ? file.data.length : 0,
        mtime: item.mtime, contentType: file.response.headers.get('content-type'),
      });
    }
  }
}

async function main() {
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const root of roots) await crawlDirectory(root);
  const files = entries.filter((item) => item.kind === 'file');
  const report = {
    capturedAt: new Date().toISOString(), baseUrl, roots,
    directoryCount: entries.filter((item) => item.kind === 'directory').length,
    fileCount: files.length,
    downloadedFileCount: files.filter((item) => item.status === 200).length,
    downloadedBytes: files.reduce((sum, item) => sum + item.downloadedBytes, 0),
    failedFiles: files.filter((item) => item.status !== 200),
    entries,
  };
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    directoryCount: report.directoryCount, fileCount: report.fileCount,
    downloadedFileCount: report.downloadedFileCount, downloadedBytes: report.downloadedBytes,
    failedFileCount: report.failedFiles.length,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
