/**
 * dsh-rightclick 自检：manifest、入口文件、locale 元数据、JS 语法，以及
 * Client 半必须遵守的几条硬约束（不 require Harness Client 包、不碰文档根、
 * ctx 服务都要在 inject 里声明、只出现主题 token 颜色、不写死 hex 颜色）。
 *
 * 用法：node scripts/check.mjs（在包目录下运行）
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));

// ── manifest ──
assert.equal(manifest.name, 'dsh-rightclick');
assert.equal(manifest.type, 'module');
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(manifest.dsh.client.platform, 'web');
assert.equal(manifest.exports['./client'], './client.js');
assert.equal(manifest.exports['.'], './index.js');

// ── 入口文件齐全 ──
for (const file of [
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'locale/en.json',
  'locale/zh.json',
  'README.md',
]) {
  assert.ok(existsSync(file), `missing file: ${file}`);
}

// ── locale 元数据（Plugin Manager 卡片读它，不激活插件） ──
for (const lang of ['en', 'zh']) {
  const dictionary = JSON.parse(readFileSync(`locale/${lang}.json`, 'utf8'));
  assert.ok(dictionary.meta.title, `locale/${lang}.json: meta.title`);
  assert.ok(dictionary.meta.description, `locale/${lang}.json: meta.description`);
}

// ── bundle patch 指向本包 ──
const patch = readFileSync('cordis.patch.yml', 'utf8');
assert.ok(patch.includes("name: 'dsh-rightclick'"), 'cordis.patch.yml: 必须插入本包的行');
assert.ok(patch.includes('id: rightclick'), 'cordis.patch.yml: 行 id');

// ── JS 语法 ──
for (const file of ['index.js', 'client.js']) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  assert.equal(result.status, 0, `${file}: ${result.error ?? 'syntax error'}`);
}

const client = readFileSync('client.js', 'utf8');

// ── Client 半硬约束 ──
assert.ok(!client.includes("require('@deepseek-ai/"), '禁止 require 任何 Harness Client 包');
assert.ok(!client.includes('document.body'), '禁止向文档根追加常驻 DOM');
assert.ok(client.includes("id: 'dsh-rightclick'"), 'Client 模块 id 必须等于包名');
assert.ok(client.includes("name: 'shell.overlay'"), '菜单浮层必须注册进 shell.overlay 槽');

// inject 声明必须覆盖所有 ctx.<service> 用法（effect/get/inject 是框架内建）。
const declared = new Set(
  [...client.match(/inject:\s*\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
);
for (const [, service] of client.matchAll(/ctx\.(\w+)/g)) {
  if (['effect', 'get', 'inject'].includes(service)) continue;
  assert.ok(declared.has(service), `Client ctx.${service} 需要在 inject 里声明`);
}

// 样式约束：不写死颜色，var() 只引用主题 token。
assert.ok(!/#[0-9a-f]{3,8}\b/i.test(client), '禁止 hex 颜色字面量');
for (const match of client.matchAll(/var\((--[^,)]+)/g)) {
  assert.ok(match[1].startsWith('--dsw-alias-'), `样式变量必须是主题 token：${match[1]}`);
}

// ── 区域判定契约 ──
// 这些选择器是「右键空白处」判定的根基，被改名即意味着行为改变，这里钉住它们。
for (const selector of [
  '[data-slot="sidebar"]',
  '[data-slot="sidebar.workspaces"]',
  '[data-row-key]',
  '[data-conversation-scroll]',
  '[data-composer-seat]',
  '[data-chat-anchor-key]',
  '[data-tool]',
]) {
  assert.ok(client.includes(selector), `缺少区域判定选择器：${selector}`);
}

// ── 八个动作都要有实现（不是空壳） ──
for (const action of [
  'refresh',
  'archive',
  'undo',
  'redo',
  'copy',
  'paste',
  'new',
  'branch',
]) {
  assert.ok(
    new RegExp(`\\n\\s+async ${action}\\(`).test(client),
    `缺少动作实现：${action}`,
  );
}

console.log('PASS: manifest、入口文件、locale 元数据、JS 语法、Client 样式与判定契约、八个动作');
