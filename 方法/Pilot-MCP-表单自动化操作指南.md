# Pilot MCP 表单自动化操作指南

> 基于 Mokahr（知乎校招）实际投递过程中积累的经验，整理不同表单字段类型的自动化操作方式。

---

## 字段类型总览

| 字段类型 | 典型场景 | 推荐工具 | 难度 |
|----------|----------|----------|------|
| 普通文本输入 | 姓名、邮箱、手机号 | `pilot_fill` | ⭐ |
| 文件上传 | 简历 PDF、附件 | `pilot_file_upload` | ⭐⭐ |
| 原生下拉框 | `<select>` 元素 | `pilot_select_option` | ⭐ |
| 自定义下拉框 | React/Ant Design 下拉 | `pilot_click_text` | ⭐⭐⭐ |
| 复选框/单选 | 协议勾选、性别选择 | `pilot_click` | ⭐ |
| 按钮 | 提交、预览、申请 | `pilot_click` | ⭐ |
| 富文本编辑器 | 自我评价、项目描述 | `pilot_type` / `pilot_fill` | ⭐⭐ |

---

## 1. 普通文本输入（最常见）

**场景**：姓名、手机号、邮箱、地址等标准 `<input>` / `<textarea>` 字段。

**操作**：

```
pilot_fill(ref="@e14", value="林承列")
```

**要点**：
- `pilot_fill` 会**自动清空**已有内容再填入新值，比 `pilot_type` 更高效
- 如果字段已有正确值，跳过即可
- 表单刷新后数据可能保留（如 Mokahr 的申请表），先 snapshot 确认再决定是否填写

---

## 2. 文件上传

### 2.1 基本用法

**场景**：上传简历 PDF、作品集等。

```
pilot_file_upload(paths=["/Users/sam/04-jianli/林承列-27届--立即到岗.pdf"])
```

### 2.2 指定目标输入框

页面上有多个文件输入时，用 `ref` 或 CSS 选择器指定：

```
pilot_file_upload(ref="input[type=file]", paths=["/path/to/file.pdf"])
```

### 2.3 实现原理

浏览器扩展本身**无法读取本地文件路径**（安全限制）。Pilot 的解决方案：

1. **MCP Node 进程**读取本地文件字节
2. 通过 WebSocket 把文件数据传给 **Chrome 扩展**
3. 扩展的 content script 构造 `File` 对象
4. 写入隐藏的 `<input type="file">` 并触发 `input` / `change` 事件

> ⚠️ **不要尝试操作系统文件选择器**（`pilot_click` 上传按钮会弹出原生对话框，无法自动控制）。

### 2.4 验证上传成功

上传后 snapshot 中上传按钮的文本会变化：
- 上传前：`button "上传简历"`
- 上传后：`button "林承列-27届--立即到岗.pdf"`

---

## 3. 原生下拉框（`<select>`）

**场景**：标准的 HTML `<select>` 元素，如学历选择、月份选择。

```
pilot_select_option(ref="@e5", value="本科")
```

**要点**：
- 支持按 `value`、`label` 或**可见文本**匹配
- 如果不确定选项值，先用 `pilot_page_html` 查看 `<option>` 列表

---

## 4. 自定义下拉框（⭐⭐⭐ 核心难点）

**场景**：Mokahr、Ant Design、React Select 等框架的自定义下拉组件。

### 4.1 为什么难

自定义下拉框的选项通常渲染在 **React Portal** 中（脱离正常 DOM 树），导致：

- ❌ `pilot_snapshot` 的可访问性树**看不到**选项
- ❌ `pilot_select_option` 不适用（不是原生 `<select>`）
- ❌ `pilot_type` + `Enter` 输入的文字**不会触发选中状态**（失去焦点后值消失）
- ❌ `pilot_find` 也找不到选项

### 4.2 推荐操作流程

```
# 步骤 1：点击下拉框触发展开
pilot_click(ref="@e10")

# 步骤 2：输入搜索文字（如果支持搜索）
pilot_type(text="北京")

# 步骤 3：用 click_text 点击可见选项
pilot_click_text(text="北京市", exact=false)

# 步骤 4：点击其他字段验证选择是否持久
pilot_click(ref="@e14")
pilot_snapshot()  # 检查下拉字段值是否保留
```

### 4.3 `pilot_click_text` 工作原理

1. 在 DOM 中搜索**可见文本**匹配的元素
2. 优先选择 `[role="option"]`、`[role="menuitem"]`、`<li>` 等语义化元素
3. 沿 DOM 向上查找可点击祖先（如 `<li>` 包裹的 `<span>`）
4. 用 `scrollIntoView` + 模拟鼠标事件 + `.click()` 触发

### 4.4 已知问题

- 部分 React 组件（如 Mokahr 的城市选择器）即使 `click_text` 点击成功，值也可能不持久——可能是因为组件监听的是 React 合成事件而非原生 DOM 事件
- **临时方案**：如果自动选中不稳定，需要手动操作该字段

### 4.5 未来可探索的方案

| 方案 | 思路 | 复杂度 |
|------|------|--------|
| React 合成事件模拟 | 找到 React Fiber 节点，触发 `onChange` | 高 |
| `dispatchEvent` 模拟 | 构造 `InputEvent` / `Event` 并冒泡 | 中 |
| 直接操作 React State | 通过 `__reactFiber` / `__reactInternalInstance` 设置状态 | 高 |
| CDP 协议注入 | 用 `Runtime.evaluate` 在页面上下文执行 | 中 |

---

## 5. 复选框 / 单选框 / 开关

**场景**：协议勾选、性别选择、通知偏好。

```
# 复选框
pilot_click(ref="@e8")

# 单选框（点击对应选项）
pilot_click(ref="@e9")
```

**要点**：
- 复选框/单选框在 snapshot 中通常有明确的 `checkbox` / `radio` role
- 如果是自定义组件（如 Ant Design Switch），直接 click 即可

---

## 6. 按钮

**场景**：提交、预览、申请职位、下一步。

```
pilot_click(ref="@e17")
```

---

## 7. 富文本编辑器

**场景**：自我评价、项目描述、备注等 `contenteditable` 区域。

```
# 点击激活编辑器
pilot_click(ref="@e20")

# 逐字输入（会触发编辑器内部的键盘事件）
pilot_type(text="项目描述内容...")

# 或直接 fill（部分编辑器支持）
pilot_fill(ref="@e20", value="项目描述内容...")
```

**要点**：
- `pilot_type` 逐字输入，触发 `keydown` / `keypress` / `input` 事件，兼容性更好
- `pilot_fill` 一次性填入，速度快但可能绕过编辑器的事件监听
- 复杂编辑器（如 Quill、TinyMCE）可能需要特殊处理

---

## 8. 页面导航与状态管理

### 8.1 获取页面状态

```
# 快速查看交互元素
pilot_snapshot(interactive_only=true)

# 查看完整页面树
pilot_snapshot()

# 查看标签页列表
pilot_tabs()

# 获取页面纯文本
pilot_page_text()

# 获取页面 HTML（用于分析 DOM 结构）
pilot_page_html()
```

### 8.2 常见页面操作

```
# 导航到新页面
pilot_navigate(url="https://example.com")

# 返回上一页
pilot_back()

# 刷新当前页
pilot_reload()

# 等待元素出现
pilot_wait(ref="@e10", state="visible", timeout=10000)
```

---

## 9. 连接稳定性

### 9.1 常见断连原因

| 原因 | 表现 | 解决方案 |
|------|------|----------|
| Chrome MV3 Service Worker 空闲回收 | snapshot 报 "Could not establish connection" | 三层保活（见下方） |
| 扩展 socket 无心跳 | 半开连接，broker 不知道扩展已断 | broker 端扩展 socket ping/pong |
| 标签页上下文丢失 | "Target page has been closed" | 恢复式 `resolveTab` 逻辑 |

### 9.2 三层保活机制

1. **WebSocket keepalive**：`background.js` 每 20 秒发心跳消息
2. **Offscreen Document**：`offscreen.js` 每 20 秒发内部消息唤醒 service worker
3. **`chrome.alarms` 兜底**：定时唤醒并重连

> 要求 Chrome >= 116，低于此版本 WebSocket 对 service worker idle timer 的保活不可靠。

### 9.3 恢复连接的标准流程

```
1. pilot_tabs()          → 确认标签页还在
2. pilot_tab_select(id)  → 切换到目标标签页
3. pilot_snapshot()      → 验证内容脚本已注入
4. 如果 snapshot 失败 → pilot_reload() 刷新页面
```

---

## 10. Mokahr 平台特别说明

### 10.1 表单结构

Mokahr（mokahr.com）是常用的校招/社招投递平台，表单通常包含：

- **申请信息区**：城市选择、推荐码、简历上传
- **个人信息区**：姓名、手机、邮箱
- **自定义问题区**：不同公司会加不同字段

### 10.2 自动解析

上传简历后 Mokahr 会**自动解析并填充**部分字段（姓名、电话等）。建议：
1. 先上传简历
2. 等 2-3 秒让解析完成
3. snapshot 检查已填充的字段
4. 补充未自动填充的字段

### 10.3 投递限制

Mokahr 通常限制"1个月内投递3个职位"，注意不要误投。

---

## 11. 完整投递实录：知乎校招（Mokahr 平台）

> 2026-06-04 实际操作记录，从打开页面到投递成功的完整流程。

### 11.1 投递目标

- **平台**：Mokahr（`app.mokahr.com`）
- **公司**：知乎（智者四海）
- **岗位**：平台产品实习生（社区研发部）
- **投递人**：林承列

### 11.2 完整操作流程

#### 第一步：导航到职位详情页

```
pilot_navigate(url="https://app.mokahr.com/campus_apply/zhihu/68321#/job/...")
```

页面加载后显示职位描述（工作职责、任职要求等）。

#### 第二步：点击"申请职位"

```
pilot_snapshot(interactive_only=true)   → 找到 "申请职位" 按钮
pilot_click(ref="@e10")                 → 点击进入申请表单
```

URL 变为 `...#/job/.../apply`，进入表单页。

#### 第三步：填写基本信息

```
pilot_fill(ref="@e14", value="林承列")
pilot_fill(ref="@e16", value="16629076367@163.com")
```

> 手机号 `16629076367` 已自动填好（可能是之前登录过的 cookie）。

#### 第四步：选择意向工作城市（⭐ 核心难点）

Mokahr 的城市选择器是自定义 React 组件，选项渲染在 portal 中，`pilot_snapshot` 看不到。

**操作步骤**：

```
# 4a. 点击城市输入框，展开下拉
pilot_click(ref="@e8")

# 4b. 用 pilot_dom_find 在完整 DOM 中搜索选项
pilot_dom_find(text="北京", visible_only=true, limit=20)
```

`pilot_dom_find` 返回多个候选元素，关键结果：

| # | class | 含义 |
|---|-------|------|
| 1 | `sd-Menu-header-2p2XI` | 分组标题"北京市" |
| 3 | `sd-Select-common-item-3mSTZ` | **实际可点击的选项** |
| 6 | `sd-Menu-content-item-37fPj` | 选项内部容器 |
| 7 | `option-label-p2B4XVc4Pn` | 选项文字 label |

```
# 4c. 用 selector 限定到下拉选项区域，精确点击
pilot_click_text(text="北京市", exact=false, selector=".sd-Select-common-item-3mSTZ")
```

```
# 4d. 验证选择是否持久——点击其他字段后检查
pilot_click(ref="@e12")     → 点击"姓名"字段
pilot_snapshot()             → 城市字段消失 + "必填项未填写"消失 = 选中成功
```

**判断成功的标志**：
- ✅ 城市字段从 `interactive_only` snapshot 中**消失**（不再是空输入框）
- ✅ "必填项未填写"提示**消失**
- ❌ 如果城市值还在但显示为 `value=""`，说明没选中

#### 第五步：上传简历

```
pilot_file_upload(paths=["/Users/sam/04-jianli/林承列-27届--立即到岗.pdf"])
```

返回：`Uploaded: 林承列-27届--立即到岗.pdf (281895B)`

验证：snapshot 中按钮文本从 `"上传简历"` 变为 `"林承列-27届--立即到岗.pdf"`。

#### 第六步：预览并提交

```
# 6a. 点击"预览并提交"
pilot_click(ref="@e14")

# 6b. 进入预览确认页面，核对信息
pilot_snapshot()
```

预览页面显示：
- 📱 +86 16629076367
- 📧 16629076367@163.com
- 📄 林承列-27届--立即到岗.pdf

```
# 6c. 点击"确认提交"
pilot_click(ref="@e16")
```

#### 第七步：确认投递成功

提交后 URL 变为 `.../campus_apply/thanks?...&candidateName=林承列`，页面显示：

> **"已成功提交申请，请静待佳音！"**

⚠️ 页面可能弹出**短信验证**弹窗，需要用户手动完成验证。

### 11.3 遇到的问题与解决

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `pilot_snapshot` 看不到下拉选项 | React Portal 渲染，不在可访问性树中 | 用 `pilot_dom_find` 搜索完整 DOM |
| `pilot_type` + Enter 选不中 | Mokahr 组件监听 React 合成事件，非原生输入 | 用 `pilot_click_text` + `selector` 定位选项 |
| 城市值点击后消失 | 没有点击到正确的祖先元素 | `pilot_click_text` 改进后自动向上找可点击祖先 |
| "Could not establish connection" | Chrome MV3 service worker 被回收 | 三层保活机制（WebSocket + offscreen + alarms） |
| "Target page has been closed" | 标签页上下文丢失 | `pilot_tab_select` 切换 + snapshot 恢复 |
| `pilot_navigate` 超时 30s | 页面加载慢但实际已加载 | 直接 `pilot_snapshot` 验证，跳过 navigate |

### 11.4 关键经验总结

1. **先 snapshot 再操作**：每次操作前确认 ref 还有效
2. **自定义下拉 = dom_find + click_text**：不要依赖 `pilot_type` + `Enter`
3. **验证持久性**：选完下拉后点其他字段，确认值不会消失
4. **连接断了别慌**：`pilot_tabs()` → `pilot_tab_select()` → `pilot_snapshot()` 三步恢复
5. **文件上传直接传路径**：`pilot_file_upload` 底层由 Node 进程读文件，不需要操作文件选择器

---

## 附录：工具速查表

| 工具 | 用途 | 关键参数 |
|------|------|----------|
| `pilot_snapshot` | 获取页面结构 | `interactive_only`, `include_cursor_interactive` |
| `pilot_click` | 点击元素 | `ref` |
| `pilot_fill` | 填写输入框（自动清空） | `ref`, `value` |
| `pilot_type` | 逐字输入 | `text`, `submit` |
| `pilot_press_key` | 按键 | `key` |
| `pilot_select_option` | 选择原生下拉框 | `ref`, `value` |
| `pilot_dom_find` | 搜索完整 DOM（含 portal/overlay） | `text`, `selector`, `exact`, `visible_only`, `limit` |
| `pilot_click_text` | 按可见文本点击（处理 portal） | `text`, `exact`, `selector` |
| `pilot_file_upload` | 上传文件 | `paths`, `ref` |
| `pilot_navigate` | 导航到 URL | `url` |
| `pilot_tabs` | 列出标签页 | — |
| `pilot_tab_select` | 切换标签页 | `id` |
| `pilot_find` | 查找元素（不截图） | `text`, `label`, `role` |
| `pilot_wait` | 等待条件 | `ref`, `state`, `timeout` |
| `pilot_scroll` | 滚动页面 | `ref`, `direction` |
| `pilot_page_html` | 获取页面 HTML | `ref`, `max_chars` |
| `pilot_page_text` | 获取页面文本 | `max_chars` |
