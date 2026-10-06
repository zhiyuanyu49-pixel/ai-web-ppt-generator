/**
 * Vite CLI 入口（带 child_process 兼容补丁）
 * ------------------------------------------------------------------
 * 用法与 `vite` 完全一致：
 *   node tools/vite-cli.mjs build
 *   node tools/vite-cli.mjs --host 127.0.0.1 --port 5173
 */
import './child-process-shim.mjs';

const viteBin = new URL('../node_modules/vite/bin/vite.js', import.meta.url);
await import(viteBin.href);
