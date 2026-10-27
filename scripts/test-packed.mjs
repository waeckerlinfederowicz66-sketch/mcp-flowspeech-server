import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, npm_config_cache: path.join(root, '.npm-cache'), LC_ALL: 'C' };
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run this check through npm run test:packed');
const destination = path.resolve(process.env.FLOWSPEECH_PACK_DESTINATION ?? root);
await mkdir(destination, { recursive: true });
const packed = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', destination], { cwd: root, env, encoding: 'utf8' }));
assert.equal(packed.length, 1);
assert.equal(packed[0].version, '0.2.1');
const archive = path.join(destination, packed[0].filename);
const expected = [
  'LICENSE', 'dist/client.js', 'dist/index.js', 'package.json', 'CHANGELOG.md',
  'README.md', 'SKILL.md', 'dist/client.d.ts', 'dist/index.d.ts',
].map(file => 'package/' + file).sort();
const members = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', env }).trim().split('\n').sort();
assert.deepEqual(members, expected, 'Unexpected archive files');
const secretPattern = /(?:npm_[A-Za-z0-9]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|pypi-[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:fs_live_|sk_live_)[A-Za-z0-9_-]{24,})/;
for (const name of members) {
  const bytes = execFileSync('tar', ['-xOf', archive, name], { env });
  assert.ok(!secretPattern.test(bytes.toString()), 'Potential credential in ' + name);
  assert.ok(!bytes.includes(Buffer.from('fake-test-key')), 'Test fixture leaked into package');
  const source = await readFile(path.join(root, name.slice('package/'.length)));
  assert.deepEqual(bytes, source, 'Archive differs from reviewed local file: ' + name);
}
const scratch = path.join(root, '.test-tmp');
await mkdir(scratch, { recursive: true });
const directory = await mkdtemp(path.join(scratch, 'packed-'));
try {
  execFileSync('tar', ['-xzf', archive, '-C', directory], { env });
  const target = path.join(directory, 'package');
  const manifest = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
  assert.equal(manifest.bin['mcp-flowspeech-server'], 'dist/index.js');
  assert.equal(manifest.version, '0.2.1');
  assert.ok((await readFile(path.join(target, manifest.bin['mcp-flowspeech-server']), 'utf8')).startsWith('#!/usr/bin/env node'));
  // Dependencies resolve from the existing workspace install; implementation imports
  // and the child stdio process both use only the extracted package's dist files.
  const result = spawnSync(process.execPath, ['--test', 'test/client.test.mjs', 'test/error-privacy.test.mjs', 'test/stdio.test.mjs'], {
    cwd: root, env: { ...env, FLOWSPEECH_TEST_PACKAGE: target }, stdio: 'inherit',
  });
  assert.equal(result.status, 0, 'Packed client/stdio regression suite failed');
  console.log(JSON.stringify({
    archive: path.basename(archive), bytes: (await readFile(archive)).length, members: members.length,
    sha256: createHash('sha256').update(await readFile(archive)).digest('hex'),
    packedSourceMatches: true, secretScan: 'passed',
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
