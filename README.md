# AI 网页 PPT 生成器

粘贴一段长文案 → 后端**流式**调用大模型（OpenAI 兼容协议）拆解为多页结构 → 前端**实时**渲染成可全屏演示、可键盘翻页的网页 PPT，支持 **6 套配色主题**与**一键导出独立 HTML**。

- 模型：默认 DeepSeek，同时支持**智谱 GLM** 与 **Kimi**，三家都是 OpenAI 兼容协议，
  可以同时配置、在页面下拉里随时切换。服务端会通过 `/models` 自动解析真实可用 id，并在页头显示结果。
- 全栈：Node.js + Express 5（SSE 流式接口）+ React 19 + Vite 8 + TypeScript
- 零外部 SDK：大模型调用用原生 `fetch` 手写 SSE 解析；导出文件不依赖任何 CDN / 网络资源

---

## 1. 快速开始

**方式 A：一键启动（推荐给日常使用）**

双击项目根目录下的 `start.bat`。它会自动完成：检查 Node → 缺依赖就装 → 缺构建就构建 →
检查服务是否已在运行 → 启动服务 → 打开浏览器 `http://127.0.0.1:8787`。
（`start.bat --no-open` 只启动不打开浏览器；脚本为 GBK 编码以便在中文 cmd 中正常显示。）

**方式 B：手动命令**

```bash
# 1) 安装依赖
npm install

# 2) 配置 API Key（复制模板后填入真实 Key）
cp .env.example .env      # Windows: copy .env.example .env

# 3) 构建前端 + 启动生产服务
npm run build
npm start                 # http://127.0.0.1:8787
```

开发模式（Vite HMR + API，`/api` 自动代理到 8787）：

```bash
npm run dev               # 打开 http://127.0.0.1:5173
```

> 没有 API Key 也能跑：在 `.env` 里设置 `MOCK_AI=1`，会使用内置的本地模拟模型
> （逐 token 流式输出合规 JSON），用于离线演示与自动化测试。

### 案例演示（一键复现）

```bash
npm start                 # 或 npm run dev
node test/demo-case.mjs   # 用真实模型跑通「校园咖啡店创业计划书」案例并逐步截图
```

产物：`samples/case-campus-cafe.html`（可直接双击打开的成品演示）与
`samples/case-shots/*.png`（从粘贴文案到导出文件独立打开的 11 张过程截图）。

## 2. 功能一览

| 能力 | 说明 |
| --- | --- |
| 多模型供应商 | DeepSeek / 智谱 GLM / Kimi 三家可选，配了几家下拉就出现几家（未配 Key 的自动置灰）；切换供应商时模型列表同步更新 |
| 长文案 → PPT 结构 | 自动提炼标题、分层要点，并选择合适版式（封面/章节/要点/两栏/数据/时间线/金句/结尾） |
| 流式输出 + 实时进度 | SSE 事件流：进度条、已完成页数、接收字符数、耗时、模型原始 JSON 流、**每完成一页立即出现缩略图** |
| 全屏演示 | 16:9 舞台自适应缩放（容器查询 + `cqw` 字号），键盘/点击/触摸滑动/滚轮翻页 |
| 讲者备注 | 每页自动生成备注，演示时按 `N` 显示 |
| 总览模式 | 按 `O` 打开全部页面缩略图，点击跳页 |
| 多套主题 | 6 套配色（深空蓝/极简白/深海青/落日暖阳/青竹绿/石墨黑），应用外壳与幻灯片**同步换肤**，选择会被记住 |
| 导出独立 HTML | 单文件自包含（内联 CSS/JS/数据），双击即可演示、可切换主题、可打印为 PDF |
| 导出 / 复制 JSON | 便于二次加工或接入其它渲染器 |
| 响应式 | 桌面双栏、平板/手机单栏；移动端无横向溢出，支持触摸滑动 |
| 容错 | 模型输出被截断/含多余文字/尾随逗号均会自动修复；增量解析失败时降级使用已生成页面 |

### 模型供应商（DeepSeek / 智谱 GLM / Kimi）

三家都是 OpenAI 兼容协议，差异只在 Key、端点和模型 id，所以可以同时配置，在页面下拉里随时切换：

| 供应商 | 环境变量前缀 | 默认端点 | 推荐模型 |
| --- | --- | --- | --- |
| DeepSeek | `DEEPSEEK_` | `https://api.deepseek.com/v1` | `deepseek-flash` |
| 智谱 GLM | `ZHIPU_` | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.7` |
| Kimi | `KIMI_` | `https://api.moonshot.cn/v1` | `kimi-k2.6` |

每家需要三个变量：`*_API_KEY`、`*_BASE_URL`、`*_MODEL`（后两个可省略，会用上表的默认值）。
配了几家，下拉里就出现几家；没配 Key 的会标注缺失的环境变量名并置灰。
用 `AI_PROVIDER=zhipu` 可以指定打开页面时默认选中哪家。

- 智谱国际站把 `ZHIPU_BASE_URL` 改成 `https://api.z.ai/api/paas/v4`
- Kimi 国际站把 `KIMI_BASE_URL` 改成 `https://api.moonshot.ai/v1`
- 想接其它 OpenAI 兼容服务（自建 vLLM、通义、豆包等），在 `server/providers.js` 里照格式加一条即可，调用层零改动

### 演示快捷键

`← → ↑ ↓ / Space / PageUp / PageDown` 翻页 · `Home / End` 首末页 · `1-9` 跳页 ·
`F` 全屏 · `O` 总览 · `T` 切换主题 · `N` 讲者备注 · `P` 打印/导出 PDF（导出页） · `Ctrl/⌘ + Enter` 生成

## 3. 目录结构

```
├── server/                  # 后端
│   ├── index.js             # Express 应用 + API 路由 + SPA 托管
│   ├── config.js            # .env 加载与配置
│   ├── ai.js                # 多供应商 OpenAI 兼容客户端（流式 SSE 解析 + 模型 id 解析）
│   ├── providers.js         # 供应商元数据：DeepSeek / 智谱 GLM / Kimi 的端点与模型清单
│   ├── prompt.js            # 提示词工程（严格 JSON 契约 + 版式白名单）
│   ├── deck.js              # JSON 修复/规范化 + 流式增量页面扫描器
│   ├── generate.js          # 生成编排：串起 token → slide → deck 事件
│   ├── mock.js              # 本地模拟模型（MOCK_AI=1）
│   ├── export.js            # 独立 HTML 导出（内联样式 + 运行时 + 数据）
│   └── dev.js               # 开发模式：同时拉起 API 与 Vite
├── shared/                  # 前后端共用（同一份代码，保证所见即所得）
│   ├── themes.js            # 6 套主题令牌
│   ├── slide-render.js      # 幻灯片渲染器（纯函数，零依赖）
│   ├── slide.css            # 幻灯片样式（站内 + 导出共用）
│   ├── export-chrome.css    # 导出文件的演示外壳样式
│   └── export-runtime.js    # 导出文件的交互运行时（翻页/全屏/主题/总览/打印）
├── web/                     # 前端（React + TS）
│   └── src/{App.tsx,components,lib,styles,types.ts}
├── tools/                   # 构建辅助（Windows 受限环境下的兼容补丁）
└── test/                    # 单元 / 接口 / 真实模型 / 浏览器端到端测试
```

设计要点：**渲染器与样式只有一份**。站内演示用 `renderSlide()` 输出 HTML，导出时把同一份
`slide-render.js` + `slide.css` + 主题令牌内联进单文件，因此导出结果与站内演示完全一致。

## 4. API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务状态、模型解析结果、**可用供应商与候选模型清单**、主题列表 |
| GET | `/api/themes` | 主题与令牌 |
| GET | `/api/deck/sample` | 内置示例长文案 |
| POST | `/api/generate` | **SSE 流式生成**，请求体：`{text, title?, slideCount?, language?, style?, provider?, model?}` |
| POST | `/api/export` | 导出独立 HTML，请求体：`{deck, theme?, notes?}` |

`provider` 取值：`deepseek` | `zhipu` | `kimi`，缺省用服务端 `AI_PROVIDER`；
`model` 为该供应商下的模型 id，缺省用其默认模型。选了没配 Key 的供应商会返回 400 并提示缺哪个环境变量。

`/api/generate` 事件序列：

```
status   {phase, message}            阶段提示（preparing / streaming / parsing）
meta     {requestedModel, resolvedModel, matchedBy, provider, providerLabel, slidesExpected}
thinking {text}                      模型思维链增量（按 200ms 聚合）
token    {text}                      JSON 文本增量
progress {slidesDone, slidesExpected, chars, elapsedMs}
slide    {index, slide}              单页完成，可立即渲染
usage    {prompt_tokens, completion_tokens, ...}
deck     {deck}                      规范化后的完整结果
done     {elapsedMs, repaired, slides}
error    {message}
end                                  流结束
```

## 5. 测试与验证

```bash
npm test              # 单元 + 接口 + 口令/限流测试（39 项，使用 MOCK 模型，不消耗额度）
npm run test:live     # 真实 DeepSeek 链路：模型解析 → 流式 → 增量解析 → 结构化校验
npm run test:e2e      # 真实浏览器端到端（MOCK 模型，47 项断言）
npm run test:e2e -- --live   # 端到端 + 真实大模型
npm run test:prod     # 生产模式冒烟（需先 npm run build && npm start）
npm run typecheck     # 前端类型检查
```

分享场景自查（真实调用一次模型）：

```bash
node test/share-check.mjs http://127.0.0.1:8787 你的口令          # 接口侧：门禁 + 生成 + 导出
node test/share-browser-check.mjs https://xxx.lhr.life 你的口令   # 浏览器侧：登录页 → 生成 → 演示
```

端到端测试通过 CDP 驱动本机 Edge/Chrome，覆盖：粘贴文案 → 点击生成 → 观察流式进度 →
自动进入演示 → 键盘翻页 → 总览跳页 → 主题切换（含令牌注入与浅色主题可读性）→
导出 HTML（真实下载）→ **用浏览器打开导出文件再次验证**（渲染、翻页、总览、主题、无脚本错误）→
移动端视口无横向溢出。截图输出到 `test/tmp/shots`。

最近一次验证结果：

- `npm test` → 39/39 通过（含 9 项口令与限流测试）
- `npm run test:live` → 12 页，事件 `token×1822 / slide×12 / thinking×2003`，约 16s，无需修复 JSON
- `npm run test:e2e -- --live` → 47/47 通过（真实 Edge 153 + DeepSeek `deepseek-flash`）
- `npm run test:prod` → 8/8 通过（生产模式：登录门禁、静态资源、模型解析、SPA 回退、移动端）
- `share-check` / `share-browser-check`（公网隧道）→ 14/14 与 11/11 通过，含一次真实 13 页生成

`samples/demo-ai-deck.html` 是一次真实生成结果的导出文件，可直接双击打开离线演示。

## 7. 分享给别人用

### 7.1 同一个 WiFi / 局域网

1. `.env` 里把 `HOST=127.0.0.1` 改成 `HOST=0.0.0.0`，重启服务；
2. 启动日志会列出局域网地址（形如 `http://192.168.x.x:8787`），别人连同一个 WiFi 打开即可；
3. 第一次启动时 Windows 防火墙会弹窗，选择「允许访问」（专用网络）。

### 7.2 公网（任何人、任何地方）

双击 `share.bat`（或执行 `npm run share`），脚本会：检查/启动本机服务 → 建立隧道 →
打印「公网链接 + 访问口令」。把这两行发给别人即可。关闭窗口（或 `Ctrl+C`）链接立即失效。

两种隧道方式，脚本会自动选择：

| 方式 | 说明 |
| --- | --- |
| `ssh`（默认兜底） | 使用 Windows 自带 `ssh.exe` 连 `localhost.run`，**零下载、秒级可用**，地址形如 `https://xxxx.lhr.life` |
| `cloudflared` | Cloudflare Quick Tunnel，更稳定，首次自动下载约 55MB 到 `tools/cloudflared.exe` |

强制指定：`node tools/share.mjs --provider ssh` 或 `--provider cloudflared`（`SHARE_DEBUG=1` 可看隧道原始日志）。

> 免费隧道会被服务端定时断开（实测约 40 分钟后断开一次）。脚本已内置**自动重连**
> （最多 20 次，退避 5-20 秒）：断开后会打印新的链接，**地址会变化**，
> 需要把新链接重新发给对方。想要固定不变的地址，请用带域名的正式部署。

### 7.3 分享时自动生效的保护

| 配置项（`.env`） | 默认 | 作用 |
| --- | --- | --- |
| `ACCESS_PASSWORD` | 空 | 访问口令；设置后未通过校验只能看到登录页，接口返回 401。Cookie 用 HMAC 签名、30 天有效、口令改了即失效 |
| `RATE_LIMIT_PER_DAY` | 15 | 每个 IP 每天最多生成几次 |
| `RATE_LIMIT_PER_MINUTE` | 3 | 每个 IP 每分钟请求上限（防连点） |
| `RATE_LIMIT_PER_DAY_GLOBAL` | 200 | 全站每天总次数上限（总额度保险丝） |
| `MAX_CONCURRENT` | 3 | 同时进行的生成任务数 |

安全边界：**API Key 只在服务端使用**，打包后的前端产物与所有接口响应里都不含 Key
（`/api/health` 也不返回），所以别人拿不走 Key —— 但他们会消耗你的额度，
因此对外分享务必设置 `ACCESS_PASSWORD` 和配额。`/api/health` 保持公开以便探活。

## 8. 说明与已知边界

- **模型 id**：每家的默认 id 见 `server/providers.js`，一般用推荐值即可；想在下拉之外尝鲜，
  可以在请求里直接传任意 `model` 字符串（长度限制 64），服务端不做白名单校验。
  若填写的 id 与服务端 `/models` 列表不一致，会按「精确 → 忽略大小写 → 规范化」三级匹配自动纠正。
- **成本**：一次 12 页生成约 1.3k 输入 token + 3.8k 输出 token（含思维链）。
  后端对思维链事件做了聚合，减少 SSE 事件量。
- **输入长度**：默认截断到 14000 字符（`MAX_INPUT_CHARS`），可按需放宽。
- **Windows 受限环境**：`tools/child-process-shim.mjs` 会把 `child_process.exec/execFile`
  创建管道时的同步 `EPERM` 转成回调错误，避免 Vite 的 `net use` 探测直接让构建失败；
  普通环境下该补丁不会生效。`test/lib/cdp.mjs` 使用 `ws` 而非 Node 内置 WebSocket，
  因为内置实现与 Edge 协商 `permessage-deflate` 后会导致 CDP 命令无响应。
- 导出文件默认只包含内容与样式，不含任何外部请求；字体使用系统字体栈，保证离线可用。

## 9. 开源许可

本项目基于 **MIT License** 开源，许可证全文见根目录 [`LICENSE`](./LICENSE)。

```
Copyright (c) 2026 zhiyuanyu49-pixel
```

你可以自由地复制、修改、合并、发布、分发、再许可和销售本软件的副本，
唯一要求是在所有副本或实质性部分中包含上述版权声明与许可声明。
软件按「原样」提供，不含任何明示或暗示的担保。

> 注意：`.env` 中的 API Key 属于你的私密凭据，**不要提交到仓库**（已在 `.gitignore` 中忽略）。
