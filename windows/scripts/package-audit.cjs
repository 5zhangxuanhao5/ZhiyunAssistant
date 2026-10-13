'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');

const machineNames = { 0x8664: 'x64', 0xaa64: 'arm64', 0x14c: 'ia32' };
function inspectPe(bytes) {
  if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) throw Error('Missing MZ executable header');
  const offset = bytes.readUInt32LE(0x3c);
  if (offset + 24 > bytes.length || bytes.readUInt32LE(offset) !== 0x00004550) throw Error('Missing or truncated PE header');
  const machine = bytes.readUInt16LE(offset + 4), arch = machineNames[machine];
  if (!arch) throw Error('Unsupported PE machine: ' + machine.toString(16));
  return { arch, machine: '0x' + machine.toString(16) };
}
function filePe(filename) {
  const fd = fs.openSync(filename, 'r');
  try {
    const first = Buffer.alloc(4096), count = fs.readSync(fd, first, 0, first.length, 0);
    if (count < 64) return inspectPe(first.subarray(0, count));
    const offset = first.readUInt32LE(0x3c);
    if (offset + 24 <= count) return inspectPe(first.subarray(0, count));
    if (offset > 1024 * 1024) throw Error('Unreasonable PE header location');
    const head = Buffer.alloc(offset + 24); fs.readSync(fd, head, 0, head.length, 0); return inspectPe(head);
  } finally { fs.closeSync(fd); }
}
function scanText(text) {
  const findings = [];
  const tests = [
    ['private credential', /sk-[A-Za-z0-9_-]{20,200}/g],
    ['private signing key', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
    ['developer macOS path', /\/(?:Users\/[^/\s"'`]+\/|Applications\/DevEco[^\s"'`]*)/g],
    ['developer Windows home path', /[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9_\u4e00-\u9fff-]+\\\\?(?:Documents|Desktop|AppData)/g],
    ['embedded session token', /eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g]
  ];
  for (const [kind, expression] of tests) for (const match of text.matchAll(expression)) findings.push({ kind, offset: match.index });
  return findings;
}
function sensitiveEntry(filename) {
  const name = filename.replace(/\\/g, '/').replace(/^\//, '');
  if (/\.(?:p12|pfx|jks|keystore|pem|key|mobileprovision|hap)$/i.test(name)) return 'signing or credential file';
  if (/(?:^|\/)(?:\.env(?:\.[^/]*)?|build-profile\.json5|local\.properties|last-account\.json|session[^/]*\.json|permissions-v1\.json|offline-v1\.json|download-jobs-v1\.json|notes-[a-f0-9-]+\.json)$/i.test(name)) return 'private local state';
  if (/(?:^|\/)(?:publish-captures|脱敏截图|resource-cache|note-images|saved-images|video-[a-f0-9]+)(?:\/|$)/i.test(name)) return 'user or course resource directory';
  if (/\.(?:png|jpe?g|webp|gif|bmp)$/i.test(name) && !/^(?:assets\/icon\.(?:png|ico)|dist\/renderer\/icon\.png)$/.test(name) && !name.startsWith('node_modules/')) return 'unexpected course or user image';
  if (/\.(?:map|log)$/i.test(name)) return 'development source map or log';
  return '';
}
function allFiles(folder) {
  const result = [];
  function visit(current) { for (const entry of fs.readdirSync(current, { withFileTypes: true })) { const filename = path.join(current, entry.name); if (entry.isDirectory()) visit(filename); else if (entry.isFile()) result.push(filename); else throw Error('Unexpected symlink or device in release: ' + path.relative(folder, filename)); } }
  visit(folder); return result;
}
function normalizeArchiveName(entry) { return String(entry).replace(/\\/g, '/').replace(/^\/+/, ''); }
function asarFilename(entry) { return normalizeArchiveName(entry).split('/').join(path.sep); }
function scanAsar(filename) {
  const findings = [], files = [];
  for (const entry of asar.listPackage(filename)) {
    // ASAR lists rooted paths using the host separator. Keep report/comparison
    // names POSIX, while its filesystem lookup requires native relative paths.
    const name = normalizeArchiveName(entry), archivePath = asarFilename(name), stat = asar.statFile(filename, archivePath, false);
    if (stat.files) continue;
    files.push({ name, size: stat.size });
    const sensitive = sensitiveEntry(name); if (sensitive) findings.push({ file: name, kind: sensitive });
    if (/\.(?:js|cjs|mjs|json|html|css|md|txt|svg|ya?ml)$/i.test(name)) {
      if (stat.size > 24 * 1024 * 1024) { findings.push({ file: name, kind: 'oversized unscanned text resource' }); continue; }
      const text = asar.extractFile(filename, archivePath).toString('utf8');
      findings.push(...scanText(text).map((match) => ({ file: name, ...match })));
    }
  }
  const metadata = JSON.parse(asar.extractFile(filename, 'package.json').toString('utf8'));
  if (!metadata.main || !files.some((entry) => entry.name === normalizeArchiveName(metadata.main))) findings.push({ file: 'package.json', kind: 'main entry missing from package' });
  for (const required of ['dist/renderer/index.html', 'dist/renderer/app.js', 'dist/renderer/app.css', 'dist/desktop/preload.cjs', 'assets/icon.png']) if (!files.some((entry) => entry.name === required)) findings.push({ file: required, kind: 'required application resource missing' });
  return { files, findings, version: metadata.version };
}
function auditPackage(folder, expectedArch) {
  if (!['x64', 'arm64'].includes(expectedArch)) throw Error('Specify --arch x64 or --arch arm64');
  const root = path.resolve(folder), archive = path.join(root, 'resources', 'app.asar');
  if (!fs.existsSync(archive)) throw Error('Packaged resources/app.asar is missing');
  const pe = [], findings = [];
  for (const filename of allFiles(root).filter((file) => /\.(?:exe|dll|node)$/i.test(file))) {
    const relative = path.relative(root, filename).replace(/\\/g, '/');
    const header = filePe(filename); pe.push({ file: relative, ...header });
    const optionalInstallerHelper = relative === 'resources/elevate.exe';
    if (header.arch !== expectedArch && !optionalInstallerHelper) findings.push({ file: relative, kind: 'wrong runtime architecture: ' + header.arch + ', expected ' + expectedArch });
  }
  if (!pe.some((item) => item.file.endsWith('.exe') && !item.file.includes('/') && item.arch === expectedArch)) findings.push({ file: root, kind: 'native Windows application executable missing' });
  const packageInfo = scanAsar(archive); findings.push(...packageInfo.findings);
  const worker = 'dist/desktop/image-worker.cjs';
  const workerFile = path.join(root, 'resources', 'app.asar.unpacked', ...worker.split('/'));
  try {
    const stat = asar.statFile(archive, asarFilename(worker), false);
    if (!stat.unpacked || !fs.existsSync(workerFile) || fs.statSync(workerFile).size !== stat.size) findings.push({ file: worker, kind: 'background image worker must be available outside ASAR' });
  } catch (_) { findings.push({ file: worker, kind: 'background image worker missing' }); }
  return { platform: 'Windows', arch: expectedArch, version: packageInfo.version, checkedAt: new Date().toISOString(), pe, asar: { files: packageInfo.files.length, bytes: fs.statSync(archive).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') }, findings, passed: !findings.length };
}
async function smokeExecutable(filename, expectedArch) {
  if (process.platform !== 'win32') throw Error('Windows startup smoke requires a Windows host');
  if (!fs.existsSync(filename)) throw Error('Installed executable missing');
  const { _electron } = require('@playwright/test');
  const exceptions = [], app = await _electron.launch({ executablePath: path.resolve(filename), timeout: 60000, env: { ...process.env } });
  try {
    const page = await app.firstWindow({ timeout: 30000 });
    page.on('pageerror', (error) => exceptions.push(error.message));
    await page.waitForSelector('#root button', { timeout: 30000 });
    const info = await page.evaluate(() => window.zhiyun.call('app.info'));
    if (!info.packaged || info.platform !== 'win32' || info.arch !== expectedArch) throw Error('Installed app reported incorrect runtime metadata');
    const encryption = await app.evaluate(({ safeStorage }) => {
      if (!safeStorage.isEncryptionAvailable()) throw Error('Windows account encryption is unavailable');
      const sample = 'zhiyun-synthetic-install-encryption-check';
      const cipher = safeStorage.encryptString(sample);
      if (cipher.includes(Buffer.from(sample)) || safeStorage.decryptString(cipher) !== sample) throw Error('Windows account encryption round trip failed');
      return true;
    });
    const imageWorker = await app.evaluate(async ({ app }) => {
      const { Worker } = require('node:worker_threads'), path = require('node:path');
      const worker = new Worker(path.join(app.getAppPath() + '.unpacked', 'dist', 'desktop', 'image-worker.cjs'));
      try {
        return await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(Error('Installed image worker timeout')), 10000);
          worker.once('error', error => { clearTimeout(timeout); reject(error); });
          worker.once('message', result => { clearTimeout(timeout); if (result.error || result.value !== true) reject(Error(result.error || 'Installed image worker comparison failed')); else resolve(true); });
          const width = 128, height = 72, pixels = new Uint8Array(width * height * 4);
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; pixels[i] = x * 7 % 256; pixels[i + 1] = y * 5 % 256; pixels[i + 2] = (x + y) * 3 % 256; pixels[i + 3] = 255; }
          worker.postMessage({ id: 1, kind: 'compare', a: pixels.slice().buffer, b: pixels.slice().buffer, width, height, strideA: width * 4, strideB: width * 4 });
        });
      } finally { await worker.terminate(); }
    });
    await page.setViewportSize({ width: 800, height: 620 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 3) throw Error('Startup page overflows the narrow desktop viewport');
    if (exceptions.length) throw Error('Renderer startup exceptions: ' + exceptions.join('; '));
    return { passed: true, installedStartup: true, accountEncryption: encryption, unpackedImageWorker: imageWorker, version: info.version, arch: info.arch, platform: info.platform, checkedAt: new Date().toISOString(), scope: 'Fresh installed startup, native account encryption, image worker and narrow-window shell; not live login/video or complete hardware QA' };
  } finally { await app.close(); }
}
async function main(argv = process.argv.slice(2)) {
  const argument = (name) => { const index = argv.indexOf(name); return index < 0 ? '' : argv[index + 1] || ''; };
  const arch = argument('--arch'), smoke = argument('--smoke'), folder = argument('--dir');
  let report;
  if (smoke) report = await smokeExecutable(smoke, arch);
  else if (folder) report = auditPackage(folder, arch);
  else throw Error('Usage: node scripts/package-audit.cjs --dir release/win-unpacked --arch x64 [--report work/audit.json] OR --smoke installed.exe --arch x64');
  const destination = argument('--report');
  if (destination) { fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n'); }
  // Findings never echo a secret value; only its file and category are reported.
  console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
  return report;
}
module.exports = { inspectPe, scanText, sensitiveEntry, normalizeArchiveName, scanAsar, auditPackage, smokeExecutable, main };
if (require.main === module) main().catch((error) => { console.error('Release audit failed:', error.message); process.exitCode = 1; });
