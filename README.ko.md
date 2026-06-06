# pilot — 실제 Chrome에서 작동하는 AI 에이전트

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

[![npm](https://img.shields.io/npm/v/pilot-mcp)](https://www.npmjs.com/package/pilot-mcp)
[![license](https://img.shields.io/github/license/samlaying/Pilot)](https://github.com/samlaying/Pilot/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/samlaying/Pilot)](https://github.com/samlaying/Pilot)

> Chrome 확장 프로그램을 설치하면, AI 에이전트가 당신이 이미 사용 중인 브라우저의 탭을 사용할 수 있습니다.

![pilot demo](pilot-demo.gif)

다른 브라우저 도구들은 모두 **새로운 익명 브라우저**를 시작합니다. 에이전트는 로그아웃 상태에서 시작하고, Cloudflare에 차단되며, 인증이 필요한 페이지에 접근할 수 없습니다.

Pilot은 Chrome 확장 프로그램 + MCP 서버입니다. 당신의 AI 에이전트를 **실제 브라우저**에 연결합니다 — 같은 세션, 같은 쿠키, 같은 로그인 상태. 에이전트가 당신과 같은 화면을 봅니다.

```
당신: "GitHub 알림 요약해줘"

→ 당신의 Chrome에 새 탭이 열림
→ 이미 GitHub에 로그인됨
→ 에이전트가 읽고, 요약하고, 완료
```

헤드리스 브라우저 불필요. 쿠키 조작 불필요. 재인증 불필요. 봇 감지 없음.

---

## 작동 원리

```
AI 에이전트 → MCP 서버 → WebSocket → Chrome 확장 → 브라우저의 탭
            (stdio)       (localhost)
```

1. **Pilot은 MCP 서버로 실행** — Claude Code, Cursor 또는 모든 MCP 클라이언트가 stdio로 연결
2. **Chrome 확장이 WebSocket으로 연결** — localhost에서
3. **에이전트가 전용 탭을获得** — 실제 Chrome 내에서 모든 세션 유지
4. **多个 에이전트가 각각 전용 탭** — 컬러 그룹으로 구분 가능

---

## 빠른 시작

### 1. MCP 서버 추가

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

### 2. Chrome 확장 설치

```bash
npx pilot-mcp --install-extension
```

Chrome 확장 관리 페이지가 열립니다. **압축 해제된 확장 프로그램 로드** 클릭 → 터미널에 표시된 경로 선택.

### 3. 사용

> "GitHub 알림 페이지 가서 요약해줘"

Chrome에 탭이 열립니다 — 이미 로그인됨.

---

## 린 스냅샷

다른 도구들은 페이지마다 50K 이상의 문자를 컨텍스트 윈도우에 쏟아붓습니다. Pilot은 최소한으로 유지합니다:

```
다른 도구:  navigate(58K) → navigate(58K) → answer        = 116K 문자
Pilot:     navigate(2K)  → navigate(2K)  → snapshot(9K)  =  13K 문자
```

`snapshot_diff`는 작업 간 변경 사항만 표시 — 중복 재읽기 없음.

적은 컨텍스트 = 빠른 응답, 낮은 API 비용, hallucination 감소.

---

## Pilot vs @playwright/mcp

| | Pilot | @playwright/mcp |
|---|---|---|
| **브라우저** | 실제 Chrome (확장) | 새로운 Chromium 인스턴스 |
| **인증 상태** | 이미 모든 사이트에 로그인됨 | 익명 — 수동 설정 필요 |
| **봇 감지** | 실제 핑거프린트 — 차단 안 됨 | Cloudflare에 차단 |
| **스냅샷 크기** | ~2K 내비게이션, ~9K 전체 | ~50-60K |
| **스냅샷 diff** | `pilot_snapshot_diff` | ❌ |
| **쿠키 가져오기** | Chrome, Arc, Brave, Edge, Comet | 수동 JSON |
| **iframe 지원** | ✅ | ❌ |
| **도구 프로필** | `core`(9) / `standard`(30) / `full`(61) | `--caps` 그룹 |
| **전송 방식** | stdio | stdio, HTTP, SSE |

---

## 3가지 프로필, 61개 도구

대부분의 LLM은 ~30개 도구를 넘기면 성능이 저하됩니다. 필요한 만큼만 로드:

| 프로필 | 도구 수 | 포함 내용 |
|---|---|---|
| `core` | 9 | 내비게이트, 스냅샷, 클릭, 입력, 타이핑, 키 누르기, 대기, 스크린샷, 스냅샷 diff |
| `standard` | 30 | Core + 탭, 스크롤, 호버, 드래그, iframe, 폼, 링크, 인증, 차단, 검색, 요소 상태 |
| `full` | 61 | Standard + 네트워크 차단, 어서션, 클립보드, 지리 위치, CDP, JS 실행, PDF, 반응형 |

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

기본값: `standard`. [전체 도구 참조 →](https://github.com/samlaying/Pilot/wiki/Tools)

---

## 헤드드 폴백

확장이 연결되지 않으면, Pilot은 자동으로 보이는 Chromium 창을 엽니다.

실제 브라우저에서 쿠키 가져오기: `pilot_import_cookies({ browser: "chrome", domains: [".github.com"] })`

**Chrome, Arc, Brave, Edge, Comet** 지원 (macOS Keychain / Linux libsecret 경유). CAPTCHA 대응: `pilot_handoff` → 수동 개입 → `pilot_resume`.

필요: `npx playwright install chromium`

---

## 요구 사항

- Node.js >= 18
- Chrome + Pilot 확장 (권장)
- macOS 또는 Linux
- 폴백만: `npx playwright install chromium`

## 보안

- 확장은 **localhost에서만 통신** (127.0.0.1)
- 출력 경로 검증으로 `PILOT_OUTPUT_DIR` 외부 쓰기 방지
- 모든 파일 작업에 패스 트래버설 보호
- `PILOT_PROFILE`로 노출할 도구 제어 (`core` / `standard` / `full`)

---

## 크레딧

핵심 아키텍처 — ref 기반 요소 선택, 스냅샷 diff, 주석 스크린샷 — [Garry Tan](https://github.com/garrytan)의 **[gstack](https://github.com/garrytan/gstack)**에서 이식. [Playwright](https://playwright.dev/)와 [MCP SDK](https://modelcontextprotocol.io/) 기반 구축.

---

Pilot이 유용하다면, [리포지토리에 Star](https://github.com/samlaying/Pilot)를 눌러주세요 — 다른 사람들이 발견하는 데 도움이 됩니다.
