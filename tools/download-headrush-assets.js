'use strict';

const fs = require('fs');
const path = require('path');

const workspace = path.resolve(__dirname, '..');
const rawDirectory = path.join(workspace, 'reference/headrush/raw');
const outputDirectory = path.join(rawDirectory, 'device-assets');
const subtree = JSON.parse(fs.readFileSync(path.join(rawDirectory, 'subtree.json'), 'utf8'));
const bundle = fs.readFileSync(path.join(rawDirectory, 'main.4a9a9934.js'), 'utf8');
const baseUrl = process.env.HEADRUSH_BASE_URL || 'http://192.168.1.129';
const hostHeader = process.env.HEADRUSH_HOST || 'headrushflexprime.local';

fs.mkdirSync(outputDirectory, { recursive: true });

async function download(relativeUrl, outputName) {
  const response = await fetch(`${baseUrl}${relativeUrl}`, { headers: { Host: hostHeader } });
  if (!response.ok) return { relativeUrl, status: response.status };
  const data = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(outputDirectory, outputName), data);
  return { relativeUrl, status: response.status, bytes: data.length, outputName };
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
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function main() {
  const moduleTypes = subtree['/Evil/API/Blocks']?.value?.ModuleTypes || [];
  const imageNames = [...new Set(moduleTypes.map((name) => name.replace(/ 2$/, '')))]
    .filter((name) => name !== 'Empty Slot')
    .sort();
  const staticMedia = [...new Set(bundle.match(/static\/media\/[A-Za-z0-9._-]+\.(?:webp|ttf|woff2?|png|svg)/g) || [])].sort();
  const ampNames = subtree['/Evil/Engine/Patch/Amp']?.meta?.properties?.Type?.['x-options']?.strings || [];
  const cabNames = subtree['/Evil/Engine/Patch/Cab']?.meta?.properties?.CabType?.['x-options']?.strings || [];

  const fixed = await Promise.all([
    download('/manifest.json', 'manifest.json'),
    download('/icon512.png', 'icon512.png'),
  ]);
  const images = await mapLimited(imageNames, 8, (name) =>
    download(`/files/Evil/Web/Blocks/img/${encodeURIComponent(name)}.webp`, `block-${name.replace(/[^A-Za-z0-9._-]+/g, '_')}.webp`));
  const ampImages = await mapLimited(ampNames, 8, (name) =>
    download(`/files/Evil/Web/Blocks/img/Amp/${encodeURIComponent(name)}.webp`, `amp-${name.replace(/[^A-Za-z0-9._-]+/g, '_')}.webp`));
  const cabImages = await mapLimited(cabNames, 8, (name) =>
    download(`/files/Evil/Web/Blocks/img/Cab/${encodeURIComponent(name)}.webp`, `cab-${name.replace(/[^A-Za-z0-9._-]+/g, '_')}.webp`));
  const media = await mapLimited(staticMedia, 8, (name) =>
    download(`/${name}`, `static-${path.basename(name)}`));

  const report = {
    capturedAt: new Date().toISOString(),
    baseUrl,
    fixed,
    advertisedImageCount: imageNames.length,
    downloadedImageCount: images.filter((item) => item.status === 200).length,
    missingImages: images.filter((item) => item.status !== 200),
    images,
    ampImages,
    cabImages,
    staticMedia: media,
  };
  fs.writeFileSync(path.join(outputDirectory, 'download-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    advertisedImageCount: report.advertisedImageCount,
    downloadedImageCount: report.downloadedImageCount,
    missingImageCount: report.missingImages.length,
    ampImageCount: ampImages.filter((item) => item.status === 200).length,
    cabImageCount: cabImages.filter((item) => item.status === 200).length,
    staticMediaCount: media.filter((item) => item.status === 200).length,
    additionalMissingCount: [...ampImages, ...cabImages, ...media].filter((item) => item.status !== 200).length,
    downloadedBytes: [...fixed, ...images, ...ampImages, ...cabImages, ...media].reduce((total, item) => total + (item.bytes || 0), 0),
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
