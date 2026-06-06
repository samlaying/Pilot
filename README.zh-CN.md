# pilot — 你的 AI 代理，直接用你的真实 Chrome

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

[![npm](https://img.shields.io/npm/v/pilot-mcp)](https://www.npmjs.com/package/pilot-mcp)
[![license](https://img.shields.io/github/license/samlaying/Pilot)](https://github.com/samlaying/Pilot/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/samlaying/Pilot)](https://github.com/samlaying/Pilot)

> 装一个 Chrome 扩展，你的 AI 代理就能直接用你正在用的浏览器。

![pilot demo](pilot-demo.gif)

其他浏览器工具都会启动一个**全新的匿名浏览器**。你的代理一上来就是登出状态，被 Cloudflare 拦截，什么都访问不了。

Pilot 是一个 Chrome 扩展 + MCP 服务器。它把你的 AI 代理连接到**你的真实浏览器** — 同样的会话、同样的 cookie、同样的登录状态。你的代理看到的和你一样。

```
你："帮我看看 GitHub 有什么新通知"

→ 在你的 Chrome 里打开一个新标签页
→ 已经登录了 GitHub
→ 代理读取、总结、搞定
```

不需要 headless 浏览器。不需要折腾 cookie。不需要重新登录。不会被反爬检测。

---

## 工作原理

```
AI 代理 → MCP 服务器 → WebSocket → Chrome 扩展 → 你浏览器里的标签页
         (stdio)       (localhost)
```

1. **Pilot 作为 MCP 服务器运行** — Claude Code、Cursor 或任何 MCP 客户端通过 stdio 连接
2. **Chrome 扩展通过 WebSocket 连接** — 在 localhost 上
3. **你的代理获得独立标签页** — 在你的真实 Chrome 里，所有会话都保留
4. **多个代理各自独立标签页** — 颜色分组，一目了然

---

## 快速开始

### 1. 添加 MCP 服务器

```json
{
  "mcpServers": {
    "pilot": {
      "command": "npx",
      "args": ["-y", "pilot-mcp"]
    }
  }
}
```

### 2. 安装 Chrome 扩展

```bash
npx pilot-mcp --install-extension
```

会打开 Chrome 的扩展管理页面。点击**加载已解压的扩展程序** → 选择终端里显示的路径。

### 3. 开始使用

> "去我的 GitHub 通知页面，帮我总结一下"

一个标签页在你的 Chrome 里打开 — 已经登录了你的账号。

---

## 精简快照

其他工具每次页面操作都会往上下文窗口倾倒 50K+ 字符。Pilot 保持精简：

```
其他工具：  navigate(58K) → navigate(58K) → answer        = 116K 字符
Pilot：    navigate(2K)  → navigate(2K)  → snapshot(9K)  =  13K 字符
```

`snapshot_diff` 只显示操作之间的变化 — 不重复读取。

更少的上下文 = 更快的响应、更低的 API 成本、更少的幻觉。

---

## Pilot vs @playwright/mcp

| | Pilot | @playwright/mcp |
|---|---|---|
| **浏览器** | 你的真实 Chrome（扩展） | 全新的 Chromium 实例 |
| **登录状态** | 已经登录所有网站 | 匿名 — 需要手动登录 |
| **反爬检测** | 真实指纹 — 不会被拦截 | 被 Cloudflare 拦截 |
| **快照大小** | ~2K 导航，~9K 完整 | ~50-60K |
| **快照差异** | `pilot_snapshot_diff` | ❌ |
| **Cookie 导入** | Chrome、Arc、Brave、Edge、Comet | 手动 JSON |
| **Iframe 支持** | ✅ | ❌ |
| **工具配置** | `core`(9) / `standard`(30) / `full`(61) | `--caps` 分组 |
| **传输方式** | stdio | stdio、HTTP、SSE |

---

## 61 个工具，3 种配置

大多数 LLM 超过 ~30 个工具就开始退化。按需加载：

| 配置 | 工具数 | 包含内容 |
|---|---|---|
| `core` | 9 | 导航、快照、点击、填写、输入、按键、等待、截图、快照差异 |
| `standard` | 30 | Core + 标签页、滚动、悬停、拖拽、iframe、表单、链接、认证、拦截、查找、元素状态 |
| `full` | 61 | Standard + 网络拦截、断言、剪贴板、地理位置、CDP、执行JS、PDF、响应式截图 |

```json
{
  "mcpServers": {
    "pilot": {
      "command": "npx",
      "args": ["-y", "pilot-mcp"],
      "env": { "PILOT_PROFILE": "standard" }
    }
  }
}
```

默认：`standard`。[完整工具参考 →](https://github.com/samlaying/Pilot/wiki/Tools)

---

## Headed 回退模式

当扩展未连接时，Pilot 会自动打开一个可见的 Chromium 窗口。

从你的真实浏览器导入 cookie：`pilot_import_cookies({ browser: "chrome", domains: [".github.com"] })`

支持 **Chrome、Arc、Brave、Edge、Comet**，通过 macOS Keychain / Linux libsecret 解密。遇到验证码：`pilot_handoff` → 你手动处理 → `pilot_resume`。

需要：`npx playwright install chromium`

---

## 系统要求

- Node.js >= 18
- Chrome + Pilot 扩展（推荐）
- macOS 或 Linux
- 仅回退模式需要：`npx playwright install chromium`

## 安全

- 扩展**仅在 localhost 通信**（127.0.0.1）
- 输出路径校验，防止写入 `PILOT_OUTPUT_DIR` 之外
- 所有文件操作都有路径遍历防护
- `PILOT_PROFILE` 控制暴露哪些工具（`core` / `standard` / `full`）

---

## 致谢

核心架构 — 基于 ref 的元素选择、快照差异、标注截图 — 移植自 [Garry Tan](https://github.com/garrytan) 的 **[gstack](https://github.com/garrytan/gstack)**。基于 [Playwright](https://playwright.dev/) 和 [MCP SDK](https://modelcontextprotocol.io/) 构建。

---

如果 Pilot 对你有帮助，请 [Star 这个仓库](https://github.com/samlaying/Pilot) — 让更多人发现它。
