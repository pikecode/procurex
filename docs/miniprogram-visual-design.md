# 小程序视觉与交互优化方案

> 范围：仅视觉层（`.wxss` 为主，`.wxml` 只增补 class 名），不改动任何功能逻辑、数据流、接口调用与页面跳转条件。
> 现状基线：`apps/miniprogram` 共 9 个页面、4 个组件、1 个自定义 tabBar，`app.wxss` + `styles/workspace.wxss` + 9 个页面 `index.wxss` 共约 1100 行样式，其中约 45% 是彼此重复或相互覆盖的定义。

---

## 一、现状诊断

### 1. 设计令牌（Design Token）几乎不存在

系统内没有令牌层，所有页面各自硬编码颜色与尺寸。同一个语义在 5 个页面里有 5 种写法：

| 语义 | 代码中实际出现的值 |
| --- | --- |
| 页面底色 | `#f7f9f8`(app) / `#f4f6f5`(store, profile, products) / `#f3f5f4`(supplier, purchaser) |
| 品牌主色 | `#167e5a` / `#137951` / `#176b4c` / `#175f40` / `#187954` |
| 次级文字 | `#7f8b85` / `#758278` / `#718078` / `#69756e` / `#66736c` / `#8a9690` |
| 分割线 | `#dce3df` / `#dfe5e1` / `#e2e6e4` / `#e5eae7` / `#e9eeeb` / `#edf0ee` / `#edf1ef` / `#eef1ef` |
| 卡片背景 | `#fff` + `border-bottom: 1rpx` + `border-radius: 0`（三处各自重写） |

`styles/workspace.wxss` 已经是共享层，但每个页面 `@import` 之后又**整段重写**了 `.business-nav`、`.business-title`、`.card` 等——共享层事实上被架空。

**代价**：任何一次品牌色或字号调整需要改 8–10 个文件；页面之间的细微色差让"换角色"时产生跳变感，直接削弱多角色工作台的产品感。

### 2. 视觉层级坍塌

`app.wxss` 顶部定义了 22/24/26/28/32/40 的字阶，但实际渲染中：

- 卡片标题 28–30rpx、行标题 27rpx、次要文字 23–25rpx —— **全部挤在 23–30rpx 的三档里**，页面没有任何元素能"跳出来"。
- `.metric-value` 31–34rpx 是页面里最大的数字，但业务上真正重要的**金额**（`.money` 27rpx、`.list-amount` 28rpx、`.procurement-amount` 28rpx）反而比统计数字小、比标签还弱。
- 列表行（`.row`）把标题、状态、单号、金额、时间、进度全塞进一个纵向流，靠 `1rpx` 分隔线区分，**没有主次分区**。同一个行里出现了 4 个 `font-size` 但没有视觉优先级。

### 3. 状态标签有三套并行实现

| 实现 | 用在 | 形态 |
| --- | --- | --- |
| `.tag` / `.tag-warn` / `.tag-fail` (app.wxss) | purchaser, finance, region, supplier, profile | 绿底圆角药丸 |
| `.status-label` + `.status-{tone}` (store/index.wxss) | store | 5 套独立色，`border-radius: 6rpx` |
| `.procurement-state` (purchaser) | purchaser 待办卡 | **纯文字，无底色** |

后果：

- **同义不同形**：财务的"待结清"是绿药丸，门店的"待结清"是 `.status-progress` 橙色药丸，采购的"待结清"是灰字。用户在四个角色间来回切换时无法建立稳定的心智模型。
- **色调缺失**：finance 页所有状态都是同一个 `.tag`，"待处理"和"已完成"视觉上完全一样——**状态失去了全部信息量**。
- `.tag` 在 `app.wxss` 里是 `white-space: nowrap`，store 页却覆盖成 `white-space: normal` + `max-width: 45%`，于是"存在收货差异"这类长状态在部分页面会被撑破、在部分页面会换行。

### 4. 卡片不是"卡片"

全应用的 `.card` 是 `border-radius: 0` + `border-bottom: 1rpx` 的**全出血白色色带**。这带来两个问题：

- 视觉上没有"分组"——所有内容在滚动时是一条连续的白色长条，页面缺少呼吸感与区块锚点。
- `.page .card` 在 supplier/purchaser 两页被整段重写（同样的 6 条属性写两遍），属于纯粹的技术债。

### 5. 导航体系有三层且互相打架

- **工作区切换**：`custom-tab-bar`，纯文字 26rpx，选中态只靠颜色 + `inset box-shadow`。
- **角色内导航**：`.business-nav`（supplier/purchaser/finance/region）、`.store-nav`（store）、`.view-tabs`（app.wxss）——**三份独立实现**，高度都是 96rpx，选中态都是"顶部 4rpx 绿条 + 淡绿底"。
- **页面内标签**：`.procurement-tabs`、`.task-tabs`、`.reconcile-tabs`、`.filter-track`、`.status-filters`——五种名字、五份 CSS，做的是同一件事。

问题：角色内导航**不显示待办数量**。采购页在 `.procurement-tab` 里辛苦做了 36rpx 的大号计数（这是全应用最好的设计决策之一），但用户要先进"待办"页才知道有没有事。导航栏应该承担"提醒"职责。

### 6. 表单控件缺乏存在感

- `input` 是 `height: 76rpx` 的**白底白卡**，只有 1rpx `#e2e9e5` 边框——放在白色卡片里几乎"消失"。
- `region` 的 `.picker-value` 甚至完全没有背景色。
- `finance-accounts` 又自己重写了一套 `.field` / `.field input`，与 app.wxss 的 `.field` 冲突。
- 间距只有 `margin-top: 18rpx` 一种节奏，字段之间没有"分组"（比如把"价格范围/商品/供应商"归成一组，把"生效时间/原因"归成另一组）。

### 7. 空态 / 加载态 / 错误态三种写法

- store 页有完整的 `.empty-state`（图标 + 文案 + 下一步按钮，80rpx 内边距）——**这是全应用最成熟的设计**；
- supplier 用 `.order-empty`（纯文字居中）；
- finance / region / finance-accounts 则是裸 `<view class="muted">暂无…</view>`。

加载态更薄：store/supplier 有 `.skeleton-line` 骨架屏，其余页面全是"正在读取订单"一行灰字。

### 8. 按钮在各页渲染不一致

`button::after { border: 0 }` 只写在 `store/index.wxss` 里。微信小程序 button 默认带一圈 `::after` 伪元素边框，因此 **purchaser / finance / region / supplier 的所有按钮都带一圈多余的灰色描边**，store 页的没有。同一个产品里按钮长得不一样。

### 9. 反馈与动效几乎为零

全应用只有两处过渡（`.group-chevron` 的 `transform`、`.statement-products-toggle` 的 `transform`）。缺少：

- 行/卡片的按压反馈（`:active` / `hover-class`）；
- 展开/收起的统一图标语义（store 用旋转 chevron，purchaser 用文字"收起商品 ∧ / 查看商品 ›"，supplier 用文字"展开/收起"）。

### 10. 语义被"借用"的样式

`.detail-line`（28rpx/600）在 supplier 页被当作金额行来用（`运费 ¥123`），在 finance 页被当作"待结算/已确认"来用。它本该是"补充说明行"，被复用后导致真正需要强调的金额反而没有专属样式。

---

## 二、优化目标与设计原则

1. **一个令牌来源**：颜色、字阶、圆角、间距只定义一次，页面只消费不重定义。
2. **三层信息骨架**：页头（身份 + 主操作）→ 内容区（区块标题 + 列表/表单）→ 底部导航（视图切换 + 待办计数）。
3. **金额优先**：所有金额用统一 `.amount` 样式（等宽数字、右对齐、比行标题大一级），标签统一用 `.status` 药丸 + tone 修饰类。
4. **每页只有一个主色来源**：绿色只表示"可操作/主按钮"，橙色表示"待处理/资金缺口"，红色表示"失败/驳回"，灰色表示"已完结/中性"。
5. **可点即有反馈**：所有可点击的行与卡片统一按压态；所有展开/收起统一 chevron 语义。
6. **零功能改动**：不新增/删除 `wx:if`、`wx:for`、`bindtap`、`data-*`，不改任何 `.js`。

---

## 三、设计系统规范

### 3.1 色彩令牌

```
品牌主色   --brand:        #167e5a   主按钮、选中态、正向数值
品牌浅底   --brand-soft:   #eaf4ef   选中态背景
品牌文字   --brand-ink:    #0f5f43   浅底上的品牌色文字（保证对比度）

文字       --ink-1:        #17211c   标题、商品名
           --ink-2:        #4a5a51   正文
           --ink-3:        #6f7c75   次要说明、单位、时间
           --ink-4:        #98a29c   占位、禁用

页面底色   --canvas:       #f2f5f3   页面背景（统一，替换三个近似的灰）
卡片底色   --surface:      #ffffff
凹陷底色   --sunken:       #f1f4f2   搜索框、分组头、输入底

分割线     --line:         #e6ebe8   唯一的分割线颜色
           --line-soft:    #eef2ef   更弱的内部分隔

语义色     --warn:         #a76613 / 底 #fdf3e3   待处理、待补款、待收货
           --danger:       #b3402f / 底 #fdeeeb   失败、驳回、缺口
           --info:         #2f5f8c  / 底 #eef4fb   提示、说明
```

### 3.2 字阶（收敛为 5 档）

| Token | 尺寸 | 用途 |
| --- | --- | --- |
| `display` | 40rpx / 700 | 账户余额、页面大标题 |
| `title` | 32rpx / 700 | 区块标题、商品名 |
| `body` | 26rpx / 400 | 正文、输入框内容、列表主行 |
| `meta` | 23rpx / 400 | 单号、时间、单位、说明 |
| `amount` | 30rpx / 700 | 所有金额（等宽数字） |
| `amount-lg` | 38rpx / 700 | 详情页头金额 |

### 3.3 间距与圆角

- 页面横向留白统一 `28rpx`；卡片内边距 `28rpx`；行间距节奏 `20 / 28 / 36rpx`。
- 卡片圆角 `20rpx`，外边距 `20rpx`，卡片间 `20rpx`——形成"浮起的白卡 + 灰底"的层次。
- 小圆角（药丸、输入框）`12rpx`；图片圆角 `12rpx`。

### 3.4 统一状态药丸 `.status`

```css
.status              默认：灰底灰字（中性 / 已完结）
.status.tone-brand   绿底绿字（进行中、已确认）
.status.tone-warn    橙底橙字（待处理、待补资金、待收货）
.status.tone-danger  红底红字（已驳回、失败、缺口）
```

所有角色、所有页面统一使用这一套。既有 `.tag` / `.status-label` / `.procurement-state` 的 class 名保留（避免破坏既有断言与 JS 绑定），但视觉完全对齐到新规范。

### 3.5 统一底部导航 `.workspace-nav` / `.role-nav`

- 高度 `96rpx`，选中态：品牌色文字 + 加粗 + 顶部 4rpx 指示条 + 浅绿底。
- 新增**待办计数角标**：`.nav-badge`（数字 > 0 时显示），把待办数从页面内容提到导航层。
- 工作区切换 tab 同样统一高度、指示条与按压态。

---

## 四、按页面的具体改造清单

### 4.1 全局层

- **`app.wxss`**：重写为令牌 + 原语层。保留全部既有 class 名，向后兼容；补齐 `button::after { border: 0 }`（修复跨页按钮描边不一致）；新增 `.amount` / `.status` / `.empty` / `.skeleton` / `.pressable` 等原语。
- **`styles/workspace.wxss`**：成为工作区外壳的唯一实现（页头、导航、卡片、列表行、详情头、返回条、按钮行），页面不再重写。

### 4.2 采购页 `pages/purchaser`

- 待办三分类的计数从"文字上方大数字"改为**导航栏角标 + 标签页数字并置**，把提醒前置。
- 待办卡片重排为：`门店名 + 金额(右)` → `单号 + 时间` → `状态药丸 + 操作入口`，操作入口改为统一 chevron + 品牌色文字。
- 详情页头把"订货金额"提到 `amount-lg`，"下货单号 / 资金状态"改为统一 fact 行。
- 供应商分组头使用凹陷底 + 圆角，与商品行拉开层级。
- 「更换供应商」从裸文字改为描边小按钮，扩大点按区域。

### 4.3 供应商页 `pages/supplier`

- 补齐 `differences` / `payments` / `reports` 三处缺失的状态色调（目前全部走默认 `.tag`）。
- 待发货订单卡片：金额改用 `.amount`，商品预览用 `.sunken` 药丸包裹，与背景分离。
- 「运费 ¥xxx」从 `.detail-line` 改为 `.amount` + "运费" 标签的两列布局。
- 账单页的 4 个指标使用统一的 `.metric` 卡片（圆角 + 凹陷底），替代现在的裸 `detail-line` 堆叠。
- 展开/收起统一 chevron 旋转。

### 4.4 门店页 `pages/store`

- 商品行：价格、起订/倍数约束、数量步进器重新分层；起订倍数用 `.tag.tone-warn` 语义化。
- 订货单卡片：金额上移为 `.amount`，进度文本降为 `.meta`，状态药丸统一。
- 空态统一为 `.empty`（图标 + 说明 + 下一步动作），替换当前三套写法。
- 收货凭证 / 证据组件使用统一圆角与间距。
- 保留其独有的 `has-checkout` 固定栏与购物车角标设计。

### 4.5 财务页 / 财务账户页

- 财务页任务列表补齐状态色；金额使用 `.amount`。
- `finance-accounts` 的 `.band` 对齐到 `.card`，`.balance-grid` 四宫格改为 2×2 圆角卡片，`.operations` 按钮统一为主/次层级。

### 4.6 授权门店页 `pages/region`

- 5 项导航在 375pt 宽度下过于拥挤 → 缩小字号与左右内边距，选中态加强。
- `.scope-filter` 门店选择器做成带图标的筛选条，明确"这是一个筛选器"。
- 详情页指标统一 `.metric` 卡片。

### 4.7 资料 / 登录 / 主数据页

- `profile`：字段列表改为卡片容器 + 标签值对齐；供货商品行状态药丸统一。
- `login`：品牌区使用 `display` 字阶，登录卡浮起，输入框有凹陷底。
- `products` / `prices`：**单位从 px 统一为 rpx**（这两个目录已在打包忽略列表中，但保持体系一致），并对齐新的卡片与状态规范。

### 4.8 组件层

- `product-card`：图片圆角、缺图态居中、加按压反馈。
- `document-no`：保持"日期重、序号轻"的既有设计（这是好的决策），统一到新的 meta 色。
- `evidence`：缩略图圆角统一，错误态对齐 danger 色。
- `custom-tab-bar`：统一高度与指示条，补按压态与安全区。

---

## 五、落地顺序

1. `app.wxss`（令牌层）+ `styles/workspace.wxss`（共享外壳）——地基。
2. `custom-tab-bar` + 通用组件。
3. purchaser → supplier → store → finance/finance-accounts → region → profile/login/products/prices。

## 六、验收

- `npm run mini:check`（表面约束：页面清单、端点、文案片段不得被破坏）
- `npm run mini:test`（页面逻辑单测：data 行为与关键模板片段不得被破坏）
- 逐页人工比对改造前后的滚动长度、点击热区与色彩一致性。

---

## 七、明确不做的事

- 不改任何 `.js`（数据、状态机、接口、跳转）。
- 不增删 `wx:if` / `wx:for` / `bindtap` / `data-*`。
- 不改 `app.json` 的页面清单与 tabBar 结构。
- 不删除任何被 `check-miniprogram-surface.mjs` / `test-miniprogram-pages.mjs` 断言引用的 class 名与文案（如 `business-nav`、`task-decision-section`、`确认改派`、`拒单通知`、`统计概览` 等）。