import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 前端构建配置
 * - root 指向 web/
 * - base 用相对路径，产物可以挂在任意子路径下
 * - 开发模式把 /api 代理到本地 API 服务（默认 8787）
 */
export default defineConfig({
  root: path.resolve(import.meta.dirname, 'web'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    strictPort: false,
    // 允许引用仓库根目录下的 shared/ 资源
    fs: { allow: [path.resolve(import.meta.dirname)] },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
});
