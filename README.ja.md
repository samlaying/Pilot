# pilot — あなたの実際のChromeで動くAIエージェント

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

[![npm](https://img.shields.io/npm/v/pilot-mcp)](https://www.npmjs.com/package/pilot-mcp)
[![license](https://img.shields.io/github/license/samlaying/Pilot)](https://github.com/samlaying/Pilot/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/samlaying/Pilot)](https://github.com/samlaying/Pilot)

> Chrome拡張機能をインストールするだけで、AIエージェントがあなたのブラウザのタブを使えるようになります。

![pilot demo](pilot-demo.gif)

他のブラウザツールはすべて**新しい匿名ブラウザ**を起動します。エージェントはログアウト状態で始まり、Cloudflareにブロックされ、認証されたページにアクセスできません。

PilotはChrome拡張機能 + MCPサーバーです。あなたのAIエージェントを**実際のブラウザ**に接続します — 同じセッション、同じCookie、同じログイン状態。エージェントがあなたと同じ画面を見ます。

```
あなた：「GitHubの通知をまとめて」

→ あなたのChromeに新しいタブが開く
→ すでにGitHubにログイン済み
→ エージェントが読み取り、要約、完了
```

ヘッドレスブラウザ不要。Cookieの操作不要。再認証不要。ボット検知されない。

---

## 仕組み

```
AIエージェント → MCPサーバー → WebSocket → Chrome拡張 → ブラウザのタブ
              (stdio)       (localhost)
```

1. **PilotはMCPサーバーとして動作** — Claude Code、Cursor、または任意のMCPクライアントがstdioで接続
2. **Chrome拡張がWebSocketで接続** — localhost上
3. **エージェントが専用タブを取得** — 実際のChrome内で、すべてのセッションを保持
4. **複数エージェントがそれぞれ専用タブ** — カラーグループで区別可能

---

## クイックスタート

### 1. MCPサーバーを追加

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

### 2. Chrome拡張をインストール

```bash
npx pilot-mcp --install-extension
```

Chromeの拡張管理ページが開きます。**パッケージ化されていない拡張機能を読み込む**をクリック → ターミナルに表示されたパスを選択。

### 3. 使う

> 「GitHubの通知ページに行って、要約して」

あなたのChromeにタブが開きます — すでにログイン済み。

---

## リーンスナップショット

他のツールは1ページごとに50K以上の文字列をコンテキストウィンドウに投入します。Pilotは最小限に抑えます：

```
他のツール：  navigate(58K) → navigate(58K) → answer        = 116K文字
Pilot：      navigate(2K)  → navigate(2K)  → snapshot(9K)  =  13K文字
```

`snapshot_diff`はアクション間の変更のみ表示 — 冗長な再読み込みなし。

少ないコンテキスト = 高速レスポンス、低APIコスト、 hallucination削減。

---

## Pilot vs @playwright/mcp

| | Pilot | @playwright/mcp |
|---|---|---|
| **ブラウザ** | 実際のChrome（拡張） | 新しいChromiumインスタンス |
| **認証状態** | すでにログイン済み | 匿名 — 手動セットアップ必要 |
| **ボット検知** | 実際のフィンガープリント — ブロックされない | Cloudflareにブロック |
| **スナップショットサイズ** | ~2K ナビゲーション、~9K 完全 | ~50-60K |
| **スナップショット差分** | `pilot_snapshot_diff` | ❌ |
| **Cookieインポート** | Chrome、Arc、Brave、Edge、Comet | 手動JSON |
| **iframeサポート** | ✅ | ❌ |
| **ツールプロファイル** | `core`(9) / `standard`(30) / `full`(61) | `--caps`グループ |
| **トランスポート** | stdio | stdio、HTTP、SSE |

---

## 3プロファイル、61ツール

ほとんどのLLMは30ツールを超えると性能が低下します。必要な分だけロード：

| ツール数 | 内容 |
|---|---|
| `core` | ナビゲート、スナップショット、クリック、フィル、タイプ、キー押下、待機、スクリーンショット、スナップショット差分 |
| `standard` | Core + タブ、スクロール、ホバー、ドラッグ、iframe、フォーム、リンク、認証、ブロック、検索、要素状態 |
| `full` | Standard + ネットワーク傍受、アサーション、クリップボード、ジオロケーション、CDP、JS実行、PDF、レスポンシブ |

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

デフォルト：`standard`。[全ツールリファレンス →](https://github.com/samlaying/Pilot/wiki/Tools)

---

## ヘッド付きフォールバック

拡張が接続されていない場合、Pilotは自動的に可視のChromiumウィンドウを開きます。

実際のブラウザからCookieをインポート：`pilot_import_cookies({ browser: "chrome", domains: [".github.com"] })`

**Chrome、Arc、Brave、Edge、Comet**対応（macOS Keychain / Linux libsecret経由）。CAPTCHA対応：`pilot_handoff` → 手動介入 → `pilot_resume`。

必要：`npx playwright install chromium`

---

## 要件

- Node.js >= 18
- Chrome + Pilot拡張（推奨）
- macOS または Linux
- フォールバックのみ：`npx playwright install chromium`

## セキュリティ

- 拡張は**localhostのみで通信**（127.0.0.1）
- 出力パス検証で`PILOT_OUTPUT_DIR`外への書き込みを防止
- すべてのファイル操作にパストラバーサル保護
- `PILOT_PROFILE`で公開するツールを制御（`core` / `standard` / `full`）

---

## クレジット

コアアーキテクチャ — refベースの要素選択、スナップショット差分、注釈付きスクリーンショット — [Garry Tan](https://github.com/garrytan)の**[gstack](https://github.com/garrytan/gstack)**から移植。[Playwright](https://playwright.dev/)と[MCP SDK](https://modelcontextprotocol.io/)上に構築。

---

Pilotが役に立ったら、[リポジトリにStar](https://github.com/samlaying/Pilot)を付けてください — 他の人の発見に役立ちます。
