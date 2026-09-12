// Runs only on the GitHub macOS runner. Packages contain no signing credentials.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const kind = process.argv[2];
assert(['device', 'simulator'].includes(kind));
assert.equal(process.platform, 'darwin');
const run = (command, args, timeout = 120000) => execFileSync(command, args, { encoding: 'utf8', timeout });
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const archiveRoot = 'src-tauri/gen/apple/build';
function findArchives(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (!entry.isDirectory()) return [];
    const path = join(directory, entry.name);
    return entry.name.endsWith('.xcarchive') ? [path] : findArchives(path);
  });
}
const archives = findArchives(archiveRoot);
assert.equal(archives.length, 1, 'Expected exactly one built archive');
const applications = join(archives[0], 'Products/Applications');
const apps = readdirSync(applications).filter(name => name.endsWith('.app'));
assert.equal(apps.length, 1);
const app = resolve(applications, apps[0]);
const plist = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', join(app, 'Info.plist')]));
assert.equal(plist.CFBundleIdentifier, 'app.rushlink.ios');
assert.equal(plist.CFBundleShortVersionString, version);
assert.deepEqual([...plist.UIDeviceFamily].sort(), [1, 2], 'Must support both iPhone and iPad');
assert(plist.NSLocalNetworkUsageDescription);
assert(plist.UISupportedInterfaceOrientations.includes('UIInterfaceOrientationLandscapeLeft'));
assert.equal(plist['UISupportedInterfaceOrientations~ipad'].length, 4);
assert.equal(run('lipo', ['-archs', join(app, plist.CFBundleExecutable)]).trim(), 'arm64');
assert(plist.CFBundleSupportedPlatforms.includes(kind === 'device' ? 'iPhoneOS' : 'iPhoneSimulator'));
const stage = resolve(`release-artifacts/ios-${kind}`);
mkdirSync(stage, { recursive: true });
const filename = kind === 'device' ? `RushLink_${version}_ios-iphone-ipad_unsigned.ipa` : `RushLink_${version}_ios-simulator-arm64.app.zip`;
if (kind === 'device') {
  const payload = resolve('release-artifacts/ios-packaging/Payload');
  mkdirSync(payload, { recursive: true });
  cpSync(app, join(payload, apps[0]), { recursive: true });
  run('ditto', ['-c', '-k', '--keepParent', payload, join(stage, filename)]);
} else {
  // Ad-hoc signing is sufficient for a simulator; this is not device signing.
  run('codesign', ['--force', '--deep', '--sign', '-', app]);
  run('ditto', ['-c', '-k', '--keepParent', app, join(stage, filename)]);
  const evidence = resolve('release-artifacts/ios-checks');
  mkdirSync(evidence, { recursive: true });
  const devices = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '-j']));
  const available = Object.entries(devices.devices).filter(([runtime]) => runtime.includes('.iOS-')).flatMap(([, list]) => list);
  const results = [];
  for (const family of ['iPhone', 'iPad']) {
    const device = available.find(entry => entry.name.startsWith(family));
    assert(device, `No ${family} simulator runtime available`);
    try {
      if (device.state !== 'Booted') run('xcrun', ['simctl', 'boot', device.udid]);
      run('xcrun', ['simctl', 'bootstatus', device.udid, '-b'], 240000);
      run('xcrun', ['simctl', 'install', device.udid, app]);
      const launch = run('xcrun', ['simctl', 'launch', device.udid, plist.CFBundleIdentifier]);
      await new Promise(resolveWait => setTimeout(resolveWait, 12000));
      const processes = run('xcrun', ['simctl', 'spawn', device.udid, 'launchctl', 'list']);
      assert(processes.split('\n').some(line => line.includes(plist.CFBundleIdentifier) && /^\d+\s/.test(line)), 'App exited after launch');
      run('xcrun', ['simctl', 'io', device.udid, 'screenshot', join(evidence, `${family}.png`)]);
      results.push({ family, name: device.name, launch: launch.trim(), passed: true });
      writeFileSync(join(evidence, 'results.json'), JSON.stringify(results, null, 2));
    } finally {
      run('xcrun', ['simctl', 'shutdown', device.udid]);
    }
  }
}
const hash = createHash('sha256').update(readFileSync(join(stage, filename))).digest('hex');
writeFileSync(join(stage, `SHA256SUMS-ios-${kind}.txt`), `${hash}  ${filename}\n`);
console.log(`Verified universal iPhone/iPad ${kind} package: ${filename}`);
