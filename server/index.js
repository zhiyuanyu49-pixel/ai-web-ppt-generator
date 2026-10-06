/**
 * HTTP 服务：API + 前端静态资源
 * ------------------------------------------------------------------
 * 路由：
 *   GET  /api/health          健康检查 / 模型解析状态（无需口令，便于探活）
 *   POST /api/auth            访问口令校验（配置了 ACCESS_PASSWORD 时启用）
 *   GET  /api/auth/status     当前设备是否已通过校验
 *   GET  /api/themes          主题列表
 *   POST /api/generate        SSE 流式生成（核心接口）
 *   POST /api/export          导出独立 HTML 文件
 *   GET  /api/deck/sample     示例文案（前端「试试示例」按钮）
 *   GET  /*                   前端 SPA（Vite 构建产物，未通过口令时返回登录页）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config, hasApiKey, ROOT_DIR } from './config.js';
import { resolveModel } from './ai.js';
import { generateDeck } from './generate.js';
import { buildExportHtml } from './export.js';
import { THEMES } from '../shared/themes.js';
import { normalizeDeck } from './deck.js';
import {
  authEnabled,
  authMiddleware,
  checkPassword,
  isAuthorized,
  renderLoginPage,
  setAuthCookie,
} from './auth.js';
import { checkGenerateLimit, recordGenerateStart, usageSnapshot } from './ratelimit.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // 内网穿透 / 反向代理后，需要信任代理层才能取到真实客户端 IP
  const trust = Number(config.trustProxy);
  app.set('trust proxy', Number.isFinite(trust) ? trust : config.trustProxy);

  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  // 简易访问日志（跳过静态资源，避免噪音）
  if (process.env.NODE_ENV !== 'test') {
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) {
        const startedAt = Date.now();
        res.on('finish', () => {
          console.log(
            `[api] ${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - startedAt}ms)`,
          );
        });
      }
      next();
    });
  }

  // --------------------------- 访问口令 ---------------------------
  app.get('/api/auth/status', (req, res) => {
    res.json({ authRequired: authEnabled(), authorized: isAuthorized(req) });
  });

  app.post('/api/auth', (req, res) => {
    if (!authEnabled()) {
      res.json({ ok: true, authRequired: false });
      return;
    }
    const password = String(req.body?.password ?? '');
    if (!checkPassword(password)) {
      // 浏览器表单提交 → 回到登录页并提示；fetch 调用 → 401
      const wantsHtml = String(req.headers.accept || '').includes('text/html');
      if (wantsHtml) {
        res.status(401).type('html').send(renderLoginPage({ error: '口令不正确，请重新输入。' }));
      } else {
        res.status(401).json({ error: '口令不正确', authRequired: true });
      }
      return;
    }
    setAuthCookie(res);
    const wantsHtml = String(req.headers.accept || '').includes('text/html');
    if (wantsHtml) {
      res.redirect(303, '/');
    } else {
      res.json({ ok: true });
    }
  });

  // --------------------------- 健康检查（公开，便于探活/监控） ---------------------------
  app.get('/api/health', async (_req, res) => {
    const model = config.mock ? { requested: config.model, resolved: 'mock-local-model', matchedBy: 'mock' } : await resolveModel();
    res.json({
      ok: true,
      hasApiKey,
      mock: config.mock,
      baseUrl: config.baseUrl,
      requestedModel: model.requested,
      resolvedModel: model.resolved,
      matchedBy: model.matchedBy,
      themes: THEMES.map((t) => t.id),
      authRequired: authEnabled(),
      usage: usageSnapshot(),
      time: new Date().toISOString(),
    });
  });

  // 口令之后的所有请求（页面 + 接口）都要校验
  app.use(authMiddleware());

  // ----------------------------- 主题 -----------------------------
  app.get('/api/themes', (_req, res) => {
    res.json({
      themes: THEMES.map((t) => ({ id: t.id, name: t.name, desc: t.desc, mode: t.mode, tokens: t.tokens })),
    });
  });

  // --------------------------- 示例文案 ---------------------------
  app.get('/api/deck/sample', (_req, res) => {
    res.json({ text: SAMPLE_TEXT });
  });

  // ------------------------- 流式生成（SSE） -------------------------
  app.post('/api/generate', async (req, res) => {
    const body = req.body || {};
    const text = String(body.text || '').trim();
    if (text.length < 20) {
      res.status(400).json({ error: '文案太短了，请至少输入 20 个字的内容。' });
      return;
    }
    if (!config.mock && !hasApiKey) {
      res.status(500).json({ error: '服务端未配置 DEEPSEEK_API_KEY，请在 .env 中配置后重启。' });
      return;
    }

    // 限流：保护分享者的模型额度
    const limit = checkGenerateLimit(req);
    if (!limit.allowed) {
      if (limit.retryAfter) res.setHeader('Retry-After', String(limit.retryAfter));
      res.status(limit.status).json({ error: limit.message });
      return;
    }
    const releaseSlot = recordGenerateStart(req);

    const input = {
      text,
      title: String(body.title || '').trim(),
      slideCount: Math.max(0, Math.min(config.maxSlides, Number(body.slideCount) || 0)),
      language: ['zh', 'en', 'auto'].includes(body.language) ? body.language : 'zh',
      style: ['business', 'tech', 'edu', 'creative', 'report'].includes(body.style) ? body.style : 'business',
    };

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    const abortController = new AbortController();
    // 注意：IncomingMessage 的 'close' 在 POST body 读完后就会触发（Node 16+），
    // 必须监听 response 的 'close' 才能正确判断「客户端断开了连接」。
    res.on('close', () => {
      if (!res.writableEnded) {
        closed = true;
        abortController.abort();
      }
    });

    /** 发送一个 SSE 事件 */
    const emit = (event, data) => {
      if (closed || res.writableEnded) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        closed = true;
      }
    };

    // 心跳，避免代理断开
    const heartbeat = setInterval(() => {
      if (closed || res.writableEnded) return;
      res.write(': keep-alive\n\n');
    }, 15000);

    try {
      await generateDeck(input, emit, { signal: abortController.signal });
    } catch (error) {
      const message = error?.name === 'AbortError' ? '生成已取消' : String(error?.message || error);
      console.error('[generate] 失败：', message);
      emit('error', { message });
    } finally {
      clearInterval(heartbeat);
      releaseSlot();
      if (!res.writableEnded && !closed) {
        res.write('event: end\ndata: {}\n\n');
        res.end();
      }
    }
  });

  // --------------------------- 导出 HTML ---------------------------
  app.post('/api/export', (req, res) => {
    const body = req.body || {};
    try {
      const deck = body.deck?.slides?.length
        ? normalizeDeck(body.deck, { maxSlides: config.maxSlides })
        : (() => {
            throw new Error('缺少可导出的演示文稿数据。');
          })();
      const { html, filename } = buildExportHtml({
        deck,
        theme: String(body.theme || 'midnight'),
        notes: Boolean(body.notes),
        anim: body.anim !== false,
      });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="presentation.html"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      res.setHeader('Content-Length', Buffer.byteLength(html));
      res.send(html);
    } catch (error) {
      res.status(400).json({ error: String(error?.message || error) });
    }
  });

  // --------------------------- 静态资源 ---------------------------
  if (fs.existsSync(config.distDir)) {
    app.use(
      express.static(config.distDir, {
        index: false,
        setHeaders(res, filePath) {
          if (/\.(js|css|woff2?)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=3600');
        },
      }),
    );
  } else {
    app.get('/', (_req, res) => {
      res
        .status(503)
        .type('html')
        .send(
          `<!doctype html><meta charset="utf-8"><title>尚未构建前端</title>
<body style="font-family:system-ui;background:#0b1020;color:#e8eeff;padding:40px;line-height:1.7">
<h1>前端尚未构建</h1>
<p>请先执行 <code>npm run build</code> 生成 <code>dist/</code>，或使用 <code>npm run dev</code> 启动开发模式（Vite 端口 5173）。</p>
</body>`,
        );
    });
  }

  // SPA 回退（Express 5 需要使用具名通配符 {*splat}）
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    const indexPath = path.join(config.distDir, 'index.html');
    if (!fs.existsSync(indexPath)) return next();
    // HTML 不缓存：避免分享链接出现「登录页 / 应用页」串台的过期页面
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(indexPath);
  });

  // 404
  app.use((req, res) => {
    res.status(404).json({ error: `未找到 ${req.method} ${req.path}` });
  });

  // 统一错误处理
  app.use((error, _req, res, _next) => {
    console.error('[server] 未捕获错误：', error);
    if (res.headersSent) return;
    res.status(500).json({ error: String(error?.message || error) });
  });

  return app;
}

/** 示例文案（前端一键填充，便于快速体验） */
const SAMPLE_TEXT = `2026 年企业级 AI 落地的三个阶段

过去两年，大模型从演示走向生产，企业关注的焦点已经从「能不能用」变成「如何稳定、可控、可衡量地用」。我们把企业级 AI 的落地路径总结为三个阶段。

第一阶段是试点验证：选择一个高频、低风险、数据可获取的场景，例如客服知识检索、合同要素提取或会议纪要生成。目标不是追求效果上限，而是在 4 到 6 周内跑通从数据到上线的完整链路，沉淀出评测集和基线指标。这个阶段最常见的失败原因是场景过大、指标模糊、缺少业务方深度参与。

第二阶段是规模化接入：把试点验证过的能力抽象成平台能力，包括统一的模型网关、提示词与版本管理、评测与灰度发布、成本与配额治理。经验数据显示，统一网关可以让接入周期缩短 60% 以上，Token 成本平均下降 35%。这一阶段的关键角色是平台团队与安全合规团队，需要提前明确数据分级、脱敏策略和审计要求。

第三阶段是价值闭环：把 AI 能力嵌入到业务流程的关键节点，用业务指标而不是模型指标衡量价值，例如工单一次解决率、合同审核人时、内容生产周期。我们观察到三个共性做法：第一，把人工兜底设计成流程的一部分，而不是异常处理；第二，为每个场景设定可回滚的开关与责任人；第三，用 A/B 实验持续对比模型版本与提示词版本。

风险方面需要重点关注四件事：数据泄露与越权访问、模型幻觉导致的错误决策、成本失控、以及合规审计缺口。对应的缓解手段包括最小权限的数据接入、检索增强与引用溯源、按部门配额与预算告警、以及全链路日志留存。

最后是组织建议：设立一个跨职能的 AI 工作组，包含业务、工程、数据、法务与安全代表，双周评审一次场景优先级；同时建立内部案例库，把每一次试点的方法论与踩坑记录下来，形成可以复用的组织资产。AI 落地的竞争，最终不是模型参数的竞争，而是流程与组织能力的竞争。`;

export { SAMPLE_TEXT };

// 直接运行时启动服务
const isMain = (() => {
  if (!process.argv[1]) return false;
  const selfPath = fileURLToPath(import.meta.url);
  return path.resolve(process.argv[1]).toLowerCase() === path.resolve(selfPath).toLowerCase();
})();
if (isMain) {
  const app = createApp();
  const server = app.listen(config.port, config.host, async () => {
    const model = config.mock ? { resolved: 'mock-local-model' } : await resolveModel();
    console.log('');
    console.log('  ✦ AI 网页 PPT 生成器');
    console.log(`  ➜ 本机访问: http://127.0.0.1:${config.port}`);
    if (config.host === '0.0.0.0') {
      for (const [name, list] of Object.entries(os.networkInterfaces())) {
        for (const item of list || []) {
          if (item.family === 'IPv4' && !item.internal) {
            console.log(`  ➜ 局域网访问: http://${item.address}:${config.port}   (${name})`);
          }
        }
      }
      console.log('  ➜ 公网分享: npm run share  （生成一次性 https 链接）');
    }
    console.log(`  ➜ 模型: ${model.resolved}${model.matchedBy === 'normalized-name' ? `（由 ${config.model} 解析而来）` : ''}`);
    console.log(`  ➜ 模式: ${config.mock ? 'MOCK 本地模拟' : 'DeepSeek 真实调用'}${fs.existsSync(config.distDir) ? '' : ' · 前端未构建（npm run build）'}`);
    console.log(
      `  ➜ 访问口令: ${
        authEnabled() ? `已启用（每 IP 每天 ${config.ratePerDay} 次 / 每分钟 ${config.ratePerMinute} 次）` : '未启用（本机使用）'
      }`,
    );
    console.log('');
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export { ROOT_DIR };
