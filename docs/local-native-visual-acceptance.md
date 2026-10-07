# 小程序原生视觉验收

更新：2026-10-06。固定C3的本轮子项，不等于C3整项签收或真机验收。

## 最新价格恢复与多角色导航

本轮补齐两项：价格发布/重算丢响应恢复9张真实原生截图，多角色三工作台导航6张截图，均已逐张复核；两个新组的review.json绑定当前manifest及每张图片SHA-256，重拍后旧复核不能沿用。`npm run mini:visual-evidence` 现在默认核对完整9组90张，仍标明C3 OPEN，剩余只有真实窄视口；12项证据检查器测试通过。下方7组75张和三项缺口是此前基线，旧报告不修改。

价格专项使用独立PXNATIVE前缀公司账期夹具：真实采购创建/确认作为准备，模板售价调整销售差额3/成本差额0；提交已完成后注入响应丢失，返回再进入按原键确认，只有一个模板新版本。共享成本调整差额0/-2，实际重算提交后丢响应；再次提交被阻止，GET刷新保留原待确认键，再按原键恢复并解除待确认，订单调整仅一条。最终订单销售28/供货18/账户流水0。9张包含编辑器、影响、两种待确认入口、发布恢复提示、重算结果和版本；截图复核无明显重叠。新报告var/native-price-recovery-evidence/manifest.json PASSED/fixtureCleanup PASSED，临时用户/商品/门店/供应商/模板删除并计数0；正常审计保留，不宣称库零写入或生产/银行验收。旧native-profile-price-evidence的0图/NOT_VERIFIED保持历史原义。

多角色专项仅登录既有多角色演示账号和读取业务，在实际390px逻辑视口切换门店/供应商/采购工作台，顶部及滚动底部业务栏与原生角色栏分层、没有明显重叠，末行可完整滚到导航上方。该账号没有自身门店/供应商绑定，不签跨范围业务操作；门店短页顶底两图一致。发现未绑定门店原来永远显示加载骨架，已在WXML优先显示绑定提示、禁用搜索并隐藏订货操作栏，保留已绑定账号正常流程与合法角色切换。修复后6图全部复核，92项小程序测试及静态通过。报告var/native-multirole-navigation-evidence/manifest.json PASSED。

脚本补本地夹具guard、1200ms限流、0600完整响应及项目重开保护；21项夹具防护通过。价格前两次采集失败分别为旧runUncertain条件、空值返回检查，均清理PASSED并留failed报告；最终运行成功。现改为真实pendingCommand、恢复成功提示与页面内部待确认清空断言，不伪造页面状态。多角色首轮非空目录假设失败已保留，修复前截图不作为本次复核结果。未重跑完整后端集成，本轮无API/迁移变化。

```bash
node --env-file-if-exists=.env scripts/capture-native-profile-prices.mjs --prices-only
node scripts/capture-role-ui-evidence.mjs --navigation-only
npm run mini:visual-evidence
npm run mini:visual-evidence-test
```

两套原生采集必须串行；再次采集后须逐张复核并更新hash绑定，不能自动将CAPTURED_PENDING_REVIEW升级为通过。日志/tmp/procurex-native-price-recovery-verified.log和/tmp/procurex-native-multirole-navigation-reviewed.log。CLI完整工具列表及现有页面工具仍无尺寸切换接口，本轮没有真实窄屏，不用mock或缩图签收。整体仍6/9，C8持续负载/兼容与C9仍开放。

## 最终证据核对入口

`npm run mini:visual-evidence` 只读核对7组75张JPEG：报告状态、唯一文件清单、存在/可解码、非空白像素及SHA-256；图片链要求800x800与清理通过。输出var/native-visual-acceptance/manifest.json，明确C3 OPEN及三项剩余，不重截图或生成业务数据。像素检查不是布局签收。`npm run mini:visual-evidence-test` 覆盖缺文件、空白、越界路径、重复清单、清理失败及价格功能证据被误升为视觉通过。

| 范围 | 证据 | 验收边界 |
| --- | --- | --- |
| 采购/供应商 | role-ui-evidence，16图 | 入口/详情与来源跳转，不是新履约提交 |
| 门店 | store-ui-evidence，14图 | 390px；旧大金额图排除，凭证图片不是页面布局 |
| 长文大金额 | store-layout-stress-evidence，1图 | 显示999999999.99；临时页面数据 |
| 档案/商品/改价 | native-entry-visual-evidence，19图 | 模拟失败不是网络故障 |
| 错误样式修复 | native-entry-error-evidence，3图 | 修复后布局，不是发布恢复 |
| 商品图片全链 | product-media-evidence，5图 | 合成图片裁剪/上传/保存/下载/展示及清理 |
| 原生业务主流程 | miniprogram-extended-evidence，17图 | 历史实际执行；付款登记为API夹具，不是当前UI重跑 |
| 模板/共享改价恢复 | native-profile-price-evidence | 功能PASSED；0截图、视觉NOT_VERIFIED仍须补 |

本次75张实际核对通过。剩余固定为真实窄视口、多角色导航复核、价格发布/恢复截图；仍6/9，生产/相机/相册/真机未验收，旧报告不修改。

## 最新实际商品图片链路

capture-product-media-evidence.mjs在真实开发者工具完成合成位图下载、原生正方形裁剪、PRODUCT上传/保存、采购编辑器缩略图与门店认证显示。5张截图、manifest PASSED/cleanup PASSED；保存后真实下载800x800、5911字节，sharp像素统计确认非空，编辑器和门店截图人工查看一致。不是商品摄影、相机或相册验收。测试商品没有配置实际订货价，门店“暂不可订”正确；本轮不签新订货流程。

仅临时PXMEDIA-UI商品及其模板项写入，结束删除自身商品/模板项和两个明确记录ID的文件对象及私有文件；商品/文件计数确认0。现有商品和价格/金融数据不修改、不播种；认证会话和商品创建审计按正常轨迹保留，不能宣称整个库零写入。脚本加本地fixture guard、1200ms限流、0600临时完整响应读取、setData及项目重开；生产/远程拒绝测试扩至19项，通过；91小程序功能、静态、语法及diff通过。

证据var/product-media-evidence/manifest.json、square-crop.jpg、product-editor-thumbnail.jpg、store-product-media.jpg；日志/tmp/procurex-native-media.log。先前入口报告的NOT_AVAILABLE仍描述当时既有商品，不伪改历史；本轮补的是新临时商品的真实图片链路。

```bash
node --env-file-if-exists=.env scripts/capture-product-media-evidence.mjs
npm run ops:fixture-test
```

必须与其他模拟器脚本串行，并使用现有本地API3114。核对当前CLI的automation_viewport_action与simulator_open_page帮助，均未提供尺寸切换参数；本轮窄屏没有执行，不以mock系统宽度或缩小截图替代真实视口。

## 最新入口与错误样式增量

只读脚本capture-native-entry-visuals.mjs在真实开发者工具完成19张入口截图：门店/供应商档案及字段、供应商目录/空搜索，商品列表/空搜索/编辑器/图片入口，快速改价初始编辑器和操作区。加载与失败布局采用页面数据模拟，恢复时调用真实读取并核对自身档案ID，不是网络故障注入或价格发布验收。没有新fixture、商品保存、订单或价格发布。

发现三个入口使用error-banner而无对应样式，app.wxss复用现有error-message样式，补齐颜色/背景/间距/换行。修复后errors-only另采集档案/商品/改价3张错误态，全部人工查看，错误提示和操作区不重叠。两个manifest均PASSED；小程序91项功能、静态、脚本语法和diff检查通过。

入口初始档案、商品列表/编辑器、改价以及修复后的三个错误态已人工查看。现有商品均无imageFile，productImage明确NOT_AVAILABLE；图片入口截图不是实际商品图片渲染通过。旧native-profile-price-evidence的NOT_VERIFIED不伪改为通过，新证据只覆盖入口及模拟状态，不替代其价格发布/恢复全链。

证据：var/native-entry-visual-evidence/manifest.json（19图）和var/native-entry-error-evidence/manifest.json（3图），错误态以修复后3图为准；日志/tmp/procurex-native-entries.log、/tmp/procurex-native-entry-errors.log。失败运行另存failed-<timestamp>.json，CLI临时完整响应0600且调用后删除。原生采集必须串行。

```bash
node scripts/capture-native-entry-visuals.mjs
node scripts/capture-native-entry-visuals.mjs --errors-only
```

默认API3114，只允许127.0.0.1；需要现有本地主流程账号，不自动重播种。下一批不重复这19张入口，只补实际商品图片、窄视口、多角色布局和主流程/改价恢复最终映射。

## 实际执行

在本机微信开发者工具打开apps/miniprogram，启动现有本地Docker数据库和API3114，不重置/重新播种业务库。现有账号登录、业务读取及订单预览；没有提交新订单、发货、收货、付款或云上传。认证会话会正常更新。

- 供应商与采购采集脚本最终PASSED，16张原生截图：列表/空搜索/详情、差异/收款/账单、订单和付款来源跳转/返回刷新，采购改派/运费/统计。
- 门店采集PASSED，14张截图：目录/空搜索/购物车/确认页、只读模拟、已完成订单/详情/履约、收货/凭证、账户/我的及认证凭证预览。其中旧long-text-large-money.jpg只显示12元，不能作为大金额验收，已由下一项替代。
- 单独stress-only采集PASSED，实际页面显示长中文名称与999999999.99价格；断言原生元素文字和显示价格后截图，已人工查看，名称换行、价格和数量控件不重叠。只改页面临时数据，随后恢复目录，不修改商品价格。
- 已人工查看登录、供应商订单/详情/收款/账单、采购列表/详情、门店目录/确认/收货凭证和独立压力截图等关键画面；并非所有入口或所有尺寸已经逐项签收。
- 门店记录逻辑视口390px宽，输出模拟器图591x1280。小程序功能测试91项及静态检查通过；本轮未重跑完整后端集成。

## 工具修复与评审结论

调用增加1200ms间隔，避免60次/分钟限流；CLI响应通过0600临时文件读取并立即删除，避免管道退出时大JSON截断。每套运行先重新打开项目，避免上次原生图片预览覆盖当前页面。页面注入使用setData接口，不用跨运行环境对象；压力测试同时修改真正用于渲染的displayPrice，并断言原生元素文本。角色截图不在已经进入目标页面后重复switchTab。

初期把双层导航判断为无条件错误，试加隐藏逻辑；实际账号包含ADMIN/HQ_FINANCE/PURCHASER/STORE/SUPPLIER，现有api.openWorkspace有意为多工作台显示系统角色栏。无条件隐藏会影响合法角色切换，本轮新增的页面/登录隐藏逻辑和相应新增测试已撤回，最终保留原有业务导航逻辑，不宣称修复了角色栏。单角色账号现有逻辑已经隐藏系统栏，多角色导航的层级/间距继续列为视觉评审项。失败原因与排除过程保留在本文，不以仅脚本返回PASSED代替截图复核。

## 证据与复现

证据：var/role-ui-evidence/manifest.json、var/store-ui-evidence/manifest.json、var/store-layout-stress-evidence/manifest.json及同目录图片。日志：/tmp/procurex-native-role.log、/tmp/procurex-native-store.log、/tmp/procurex-native-stress.log。三套脚本共用模拟器，必须串行执行，不能并发。

```bash
PROCUREX_API_BASE=http://127.0.0.1:3114/api/v1 node scripts/capture-store-ui-evidence.mjs
PROCUREX_API_BASE=http://127.0.0.1:3114/api/v1 node scripts/capture-store-ui-evidence.mjs --stress-only
PROCUREX_API_BASE=http://127.0.0.1:3114/api/v1 node scripts/capture-role-ui-evidence.mjs
npm run mini:test
npm run mini:check
```

需要现有本地主流程种子和已通过的extended manifest；不为截图自动重播种。完整门店采集最后打开合成收货凭证图片，后续采集会重开自己的项目窗口以关闭覆盖层。收货凭证图片的内容不是当前业务页面，也不用于证明当前页面视觉。

## 剩余范围

C3仍开放：仅较窄真实视口。多角色导航、价格发布恢复截图及最终映射本轮已补；模拟加载/失败仍不是网络故障验收，凭证预览不是相机/相册或真实设备验收。C8持续负载/兼容及C9最终交接不因本批截图完成自动关闭。
