'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const vm = require('node:vm');
const esbuild = require('esbuild');
const { normalizeArchiveName, scanAsar, auditPackage, checkInstalledImageWorker } = require('../scripts/package-audit.cjs');

async function fixture(extra = {}, omitted = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyun-asar-paths-'));
  const source = path.join(root, 'source'), unpacked = path.join(root, 'release');
  fs.mkdirSync(path.join(unpacked, 'resources'), { recursive: true });
  const resources = {
    'package.json': JSON.stringify({ name: 'synthetic-package', version: '0.0.0-test', main: 'dist/desktop/main.cjs' }),
    'THIRD_PARTY_NOTICES.md': 'Synthetic third-party notices, no real account or coursework.',
    'dist/desktop/main.cjs': 'module.exports = {};',
    'dist/desktop/preload.cjs': 'module.exports = {};',
    'dist/desktop/image-worker.cjs': 'module.exports = {};',
    'dist/renderer/index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
    'dist/renderer/app.js': 'console.log("synthetic app");',
    'dist/renderer/app.css': 'body { margin: 0; }',
    'assets/icon.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQEBAEbGKTQAAAAASUVORK5CYII=', 'base64'),
    ...extra
  };
  for (const [name, content] of Object.entries(resources)) {
    if (omitted.includes(name)) continue;
    const filename = path.join(source, ...name.split('/'));
    fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, content);
  }
  const archive = path.join(unpacked, 'resources', 'app.asar');
  await asar.createPackageWithOptions(source, archive, { unpack: '**/image-worker.cjs' });
  const pe = Buffer.alloc(256); pe.writeUInt16LE(0x5a4d, 0); pe.writeUInt32LE(0x80, 0x3c); pe.writeUInt32LE(0x4550, 0x80); pe.writeUInt16LE(0x8664, 0x84);
  fs.writeFileSync(path.join(unpacked, 'Synthetic.exe'), pe);
  return { archive, unpacked, cleanup: () => { asar.uncache(archive); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('ASAR rooted native names normalize to identical report paths without losing nested entries', () => {
  for (const entry of ['/dist/desktop/main.cjs', '\\dist\\desktop\\main.cjs', '\\\\dist\\desktop\\main.cjs']) assert.equal(normalizeArchiveName(entry), 'dist/desktop/main.cjs');
  assert.equal(normalizeArchiveName('\\THIRD_PARTY_NOTICES.md'), 'THIRD_PARTY_NOTICES.md');
});

test('real ASAR scan and package audit find native nested resources and unpacked worker on this OS', async () => {
  const value = await fixture();
  try {
    const scanned = scanAsar(value.archive);
    assert.deepEqual(scanned.findings, []);
    assert.ok(scanned.files.some(file => file.name === 'THIRD_PARTY_NOTICES.md'));
    for (const file of scanned.files) assert.equal(file.name.includes('\\'), false);
    assert.ok(scanned.files.some(file => file.name === 'dist/renderer/index.html'));
    const result = auditPackage(value.unpacked, 'x64');
    assert.equal(result.passed, true); assert.deepEqual(result.findings, []);
    assert.equal(result.pe[0].arch, 'x64');
    const worker = path.join(value.unpacked, 'resources', 'app.asar.unpacked', 'dist', 'desktop', 'image-worker.cjs');
    fs.unlinkSync(worker);
    assert.throws(() => auditPackage(value.unpacked, 'x64'), error => error.code === 'ENOENT' && String(error.path).replace(/\\/g, '/').endsWith('/app.asar.unpacked/dist/desktop/image-worker.cjs'));
  } finally { value.cleanup(); }
});

test('native ASAR path normalization does not relax privacy scans or missing renderer checks', async () => {
  const value = await fixture({ 'resource-cache/slides/private.png': Buffer.from([1, 2, 3]) }, ['dist/renderer/app.css']);
  try {
    const result = auditPackage(value.unpacked, 'x64');
    assert.equal(result.passed, false);
    assert.ok(result.findings.some(finding => finding.file === 'resource-cache/slides/private.png' && finding.kind === 'user or course resource directory'));
    assert.ok(result.findings.some(finding => finding.file === 'dist/renderer/app.css' && finding.kind === 'required application resource missing'));
  } finally { value.cleanup(); }
});

test('serialized installed-worker smoke runs actual production comparison without a global CJS require', async () => {
  const compiled = esbuild.buildSync({ entryPoints: [path.resolve(__dirname, '../src/desktop/image-worker.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false }).outputFiles[0].text;
  const value = await fixture({ 'dist/desktop/image-worker.cjs': compiled });
  try {
    // Model Playwright's main-process function evaluation, which has process and
    // builtin modules but no CommonJS module-local require. Run the real worker.
    const check = vm.runInNewContext('(' + checkInstalledImageWorker.toString() + ')', { process, setTimeout, clearTimeout, Uint8Array, Error });
    assert.equal(await check({ app: { getAppPath: () => value.archive } }), true);
  } finally { value.cleanup(); }
});

test('NSIS archives use decoder-compatible compression even when the environment asks for another CPU filter', () => {
  const { compute7zCompressArgs } = require('app-builder-lib/out/targets/archive');
  const previousFilter = process.env.ELECTRON_BUILDER_7Z_FILTER, previousLevel = process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL;
  try {
    delete process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL;
    for (const requested of ['BCJ2', 'ARM']) {
      process.env.ELECTRON_BUILDER_7Z_FILTER = requested;
      for (const compression of ['normal', 'maximum']) {
        const args = compute7zCompressArgs('7z', { installTimeDecodable: true, compression });
        assert.equal(args.filter(arg => arg.startsWith('-mf=')).join(' '), '-mf=BCJ');
      }
      const stored = compute7zCompressArgs('7z', { installTimeDecodable: true, compression: 'store' });
      assert.ok(stored.includes('-mx=0')); assert.equal(stored.some(arg => arg.startsWith('-mf=')), false);
    }
  } finally {
    if (previousFilter === undefined) delete process.env.ELECTRON_BUILDER_7Z_FILTER; else process.env.ELECTRON_BUILDER_7Z_FILTER = previousFilter;
    if (previousLevel === undefined) delete process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL; else process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL = previousLevel;
  }
});
