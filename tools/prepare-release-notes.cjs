const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const [tag, sha] = process.argv.slice(2);
assert.match(tag || '', /^v\d+\.\d+\.\d+(?:[-+].+)?$/, 'expected a v* semantic version tag');
assert.match(sha || '', /^[0-9a-f]{40}$/i, 'expected a full commit SHA');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(tag.slice(1), pkg.version, `tag ${tag} must match package version ${pkg.version}`);

const notes = fs.readFileSync(path.join(root, 'docs', 'release-notes', 'pending.md'), 'utf8').trim();
assert.ok(notes.startsWith(`# AIHub Desktop ${pkg.version}`), 'release notes heading must match package version');

const sections = [
  notes,
  '## 下载',
  '- Windows x64：免安装版和 NSIS 安装版',
  '- Linux x64：AppImage',
  '- macOS x64：Intel DMG',
  '- macOS arm64：Apple Silicon DMG',
  '## 安装提示',
  '当前产物未进行 Windows 或 Apple 代码签名。Windows 可能显示“未知发布者”；macOS 首次运行时可能需要在“隐私与安全性”中手动允许。',
  `构建提交：\`${sha}\``
];
fs.writeFileSync(path.join(root, 'release-body.md'), `${sections.join('\n\n')}\n`, 'utf8');
console.log(`Prepared release notes for ${tag}.`);
