# Pilot MCP 职位搜索与详情获取

> 基于 Mokahr（知乎校招）职位列表页的实际操作，记录从打开职位列表到获取岗位详情的完整思考过程和工具使用。

---

## 场景描述

**目标**：在 Mokahr 职位列表页（`#/jobs`）中，筛选出 北京市 + 在校生/实习生 + 产品类 的岗位，打开一个不是"平台产品实习生"的职位，记录岗位详情。

**页面**：`https://app.mokahr.com/campus_apply/zhihu/68321#/jobs`

---

## 完整操作过程

### 第一步：确认页面状态

```
pilot_snapshot(interactive_only=true)
```

**思考**：先看当前页面的交互元素，了解页面结构。页面包含：
- 顶部导航（首页、职位列表等）
- 搜索框
- 筛选区域（标签 tag + 下拉框 dropdown）
- 职位卡片列表
- 分页按钮

**关键发现**：`snapshot` 的 `interactive_only` 模式只返回 `@eN` ref 的交互元素。Mokahr 的筛选标签（如"北京市"、"产品类"）**不出现在 snapshot 中**——因为它们是自定义 `sd-Tag` 组件，不在可访问性树中。

---

### 第二步：定位筛选标签 — 失败路径

#### ❌ 尝试 1：`pilot_click_text` 直接点击

```
pilot_click_text(text="产品类", exact=true)
```

**结果**：返回 "Clicked visible text" 但筛选**没有生效**。

**原因分析**：`click_text` 找到了 DOM 中包含"产品类"文字的元素并触发了原生 `click()`，但 Mokahr 的 `sd-Tag` 组件监听的是 React 合成事件（SyntheticEvent），原生 DOM 点击不会触发 React 状态更新。另外 `click_text` 可能点到了职位卡片里显示的"产品类"文字，而不是筛选标签。

**教训**：`click_text` 返回"成功"不代表实际生效，需要验证结果。

#### ❌ 尝试 2：`pilot_click` 用 CSS 选择器

```
pilot_click(ref=".tag-container-JBkh0v2ZB8")
```

**结果**：`Element not found`。

**原因分析**：Mokahr 使用 CSS Modules（类名带 hash 后缀如 `tag-container-JBkh0v2ZB8`），`pilot_click` 的 `ref` 参数虽然支持 CSS 选择器，但复杂选择器可能匹配不到。

**教训**：CSS Modules 的 hash 类名不稳定，不适合做选择器。

#### ❌ 尝试 3：`pilot_click_text` + selector 限定

```
pilot_click_text(text="产品类", exact=true, selector=".tag-select-ajm7eeyFnL")
```

**结果**：`Visible text not found: 产品类`。

**原因分析**：加了 selector 限定后，搜索范围缩小到 `.tag-select-ajm7eeyFnL` 容器内，但 `click_text` 的文本搜索逻辑可能在容器内找不到精确匹配。

---

### 第三步：正确的做法 — `pilot_dom_find` + 截图验证

#### 3.1 用 `pilot_dom_find` 搜索完整 DOM

```
pilot_dom_find(text="实习生", visible_only=true, limit=10)
```

**返回**：找到了 `sd-Tree-tree-node-box` 元素，这是筛选下拉框中的树形节点。

**返回的关键信息**：
- `selector`：元素的完整 CSS 路径
- `clickSelector`：推荐的点击目标（向上查找可点击祖先）
- `clickTarget`：实际应该点击的元素
- `clickClassName`：目标元素的 class
- `rect`：元素在页面上的坐标和尺寸

#### 3.2 `pilot_dom_find` 搜索"产品类"标签

```
pilot_dom_find(text="产品类", visible_only=true, limit=10)
```

**返回**：找到了 `sd-Tag-container` 元素，确认这是一个 **可点击标签（Tag）** 而非下拉框。

#### 3.3 截图验证 UI 类型

```
pilot_screenshot(clip={"x": 140, "y": 280, "width": 900, "height": 250})
```

**目的**：截图确认筛选区域是"标签 tag"还是"下拉框 dropdown"，因为两者的操作方式完全不同：
- **标签 Tag**：直接点击即选中/取消
- **下拉框 Dropdown**：先点击展开，再选择选项

---

### 第四步：跳过筛选，直接从完整列表定位目标岗位

**思考转变**：筛选标签无法可靠自动选中（React 合成事件问题），但 snapshot 已经返回了完整的职位列表。我可以直接从列表中找到符合条件的岗位。

**匹配条件**：北京市 + 实习 + 产品类，排除"平台产品实习生"

从 snapshot 列表中逐条分析：

| @ref | 岗位名称 | 类型 | 城市 | 类别 | 匹配？ |
|------|----------|------|------|------|--------|
| @e47 | 平台产品实习生 | 实习 | 北京市 | 产品类 | ❌ 已投递 |
| @e67 | **产品运营实习生** | 实习 | 北京市 | 产品类 | ✅ |
| @e69 | 产品设计实习生 | 实习 | 北京市 | 设计类 | ❌ 非产品类 |

**结论**：`@e67 产品运营实习生` 是唯一匹配的岗位。

```
pilot_click(ref="@e67")
```

页面跳转到 `.../job/e55f7463-dced-4cb0-818c-623169a3bf0a`。

---

### 第五步：获取岗位详情

```
pilot_snapshot()
```

从返回的文本内容中提取岗位信息：

- **职位名称**：产品运营实习生
- **发布日期**：2026-05-14
- **工作职责**：4 条（活动策划、数据分析、用户反馈、跨部门协作）
- **任职要求**：4 条（研一研二在读、本科及以上、能力要求、Office）

---

## 工具使用总结

| 步骤 | 工具 | 用途 | 结果 |
|------|------|------|------|
| 1 | `pilot_snapshot(interactive_only=true)` | 查看页面交互元素 | ✅ 拿到完整职位列表 |
| 2 | `pilot_click_text` | 尝试点击筛选标签 | ❌ 未生效 |
| 3 | `pilot_click` + CSS selector | 尝试用选择器点击 | ❌ 找不到元素 |
| 4 | `pilot_dom_find` | 搜索完整 DOM 定位标签 | ✅ 找到元素和选择器 |
| 5 | `pilot_screenshot` | 截图验证 UI 类型 | ✅ 确认是 tag 还是 dropdown |
| 6 | `pilot_click(ref="@e67")` | 点击目标职位卡片 | ✅ 跳转到详情页 |
| 7 | `pilot_snapshot()` | 获取详情页完整内容 | ✅ 提取岗位信息 |

---

## 核心经验

### 1. 筛选标签 vs 下拉框的判断

| 特征 | 标签 Tag | 下拉框 Dropdown |
|------|----------|------------------|
| snapshot 可见 | ❌ 不显示 | ✅ 显示为 textbox |
| dom_find class | `sd-Tag-container` | `sd-Dropdown-container` |
| 操作方式 | 直接点击 | 先展开再选 |
| React 事件 | 合成事件，原生 click 可能无效 | 同上 |

### 2. 筛选不生效时的替代方案

当自动筛选无法可靠操作时，有三种替代方案：

**方案 A：从完整列表中人工筛选**（本次采用）
- `pilot_snapshot` 返回所有职位卡片
- 逐条匹配条件（城市、类型、类别）
- 直接 `pilot_click` 点击目标卡片
- **优点**：简单可靠，不需要与筛选 UI 交互
- **缺点**：列表太长时需要翻页

**方案 B：用搜索框**
```
pilot_fill(ref="@e9", value="产品运营 实习")
pilot_click(ref="@e10")  // 搜索按钮
```
- **优点**：快速缩小范围
- **缺点**：搜索结果可能不精确

**方案 C：直接构造 URL 参数**
```
pilot_navigate(url="...#/jobs?city=北京市&type=实习生&category=产品类")
```
- **优点**：最精确
- **缺点**：需要知道 URL 参数格式

### 3. `pilot_dom_find` 是关键诊断工具

当 `snapshot` 看不到元素时，用 `dom_find` 可以：
- 确认元素**是否存在于 DOM 中**（区分"不存在"和"不可见"）
- 获取元素的 `selector`、`clickSelector`、`rect` 坐标
- 判断元素的类型（class 名称暗示组件类型）
- 为后续的 `click_text` 或 `click` 提供精确选择器

### 4. 验证每一步的结果

- `click_text` 返回"成功"≠ 实际生效 → 需要 snapshot 验证
- `snapshot` 中元素消失 ≠ 坏事 → 可能是被选中后 UI 变化
- `navigate` 超时 ≠ 失败 → 页面可能已加载，直接 snapshot 确认

---

## 后续改进方向

1. **React 合成事件支持**：在 content script 中检测 React Fiber，直接触发 `onChange`/`onClick` 合成事件
2. **Tag 筛选器专用工具**：新增 `pilot_select_tag(text)` 专门处理标签选择器
3. **URL 参数构造**：解析 Mokahr 的 URL hash 格式，直接用参数跳转
4. **职位列表解析**：新增 `pilot_parse_job_list()` 工具，自动提取列表中的岗位名称、城市、类别等结构化数据
