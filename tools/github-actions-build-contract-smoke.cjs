const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const workflowPath = path.join(root, '.github', 'workflows', 'build.yml');
const releaseNotesScript = fs.readFileSync(path.join(root, 'tools', 'prepare-release-notes.cjs'), 'utf8');

assert.deepEqual(pkg.build.win.target, ['portable', 'nsis']);
assert.deepEqual(pkg.build.linux.target, ['AppImage']);
assert.ok(pkg.build.linux.artifactName.includes('${version}'));
assert.ok(pkg.build.linux.artifactName.includes('${arch}'));
assert.deepEqual(pkg.build.mac.target, ['dmg']);
assert.ok(pkg.build.dmg.artifactName.includes('${version}'));
assert.ok(pkg.build.dmg.artifactName.includes('${arch}'));

const workflow = fs.readFileSync(workflowPath, 'utf8');

for (const required of [
  'workflow_dispatch:',
  'branches: [main]',
  "tags: ['v*']",
  'contents: write',
  'windows-latest',
  'ubuntu-latest',
  'macos-latest',
  'npm ci',
  '--win --x64 --publish never',
  '--linux AppImage --x64 --publish never',
  'path: dist/*.AppImage',
  '--mac dmg --x64 --publish never',
  '--mac dmg --arm64 --publish never',
  'if-no-files-found: error',
  'retention-days: 14'
]) {
  assert.ok(workflow.includes(required), `workflow must include ${required}`);
}

assert.equal((workflow.match(/actions\/upload-artifact@v4/g) || []).length, 4);
assert.equal((workflow.match(/actions\/checkout@v4/g) || []).length, 5);
assert.equal((workflow.match(/actions\/setup-node@v4/g) || []).length, 5);
assert.equal((workflow.match(/actions\/download-artifact@v4/g) || []).length, 4);
assert.ok(workflow.includes("if: startsWith(github.ref, 'refs/tags/v')"));
assert.ok(workflow.includes('needs: [windows-x64, linux-x64, macos-x64, macos-arm64]'));
assert.ok(workflow.includes('node tools/prepare-release-notes.cjs'));
assert.ok(releaseNotesScript.includes('release-notes'));
assert.ok(releaseNotesScript.includes('pending.md'));
assert.ok(workflow.includes('softprops/action-gh-release@v2'));
assert.ok(workflow.includes('body_path: release-body.md'));
assert.ok(workflow.includes('release-assets/**/*'));
assert.ok(!workflow.includes('ghp_'), 'workflow must not contain a GitHub token');

console.log('GitHub Actions build contract smoke test passed.');
