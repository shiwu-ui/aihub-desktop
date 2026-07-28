const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'release-body.md');
const sha = '0123456789abcdef0123456789abcdef01234567';

fs.rmSync(output, { force: true });
const result = spawnSync(process.execPath, [path.join(__dirname, 'prepare-release-notes.cjs'), `v${pkg.version}`, sha], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(result.status, 0, result.stderr);
const body = fs.readFileSync(output, 'utf8');
assert.ok(body.includes(`# AIHub Desktop ${pkg.version} 更新说明`));
assert.ok(body.includes('Windows x64'));
assert.ok(body.includes('Linux x64'));
assert.ok(body.includes('macOS x64'));
assert.ok(body.includes('macOS arm64'));
assert.ok(body.includes('未进行 Windows 或 Apple 代码签名'));
assert.ok(body.includes(sha));
fs.rmSync(output, { force: true });
console.log('Release notes smoke test passed.');
