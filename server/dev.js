/**
 * 开发模式：同时启动 API 服务（8787）与 Vite 开发服务器（5173）
 * 访问 http://127.0.0.1:5173 ，/api 会自动代理到 8787。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteCli = path.join(root, 'tools', 'vite-cli.mjs');

if (!fs.existsSync(viteCli)) {
  console.error('未找到 tools/vite-cli.mjs');
  process.exit(1);
}

const children = [];
let closing = false;

function run(name, args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env });
  children.push({ name, child });
  child.on('exit', (code) => {
    if (!closing) {
      console.log(`[dev] ${name} 已退出（code=${code}）`);
      shutdown();
    }
  });
  return child;
}

function shutdown() {
  if (closing) return;
  closing = true;
  for (const { child } of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(0), 400);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[dev] 启动 API 服务 (http://127.0.0.1:8787) 与前端开发服务器 (http://127.0.0.1:5173)');
run('api', [path.join(root, 'server', 'index.js')]);
run('vite', [viteCli, '--host', '127.0.0.1', '--port', '5173']);
