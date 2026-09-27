# M4 Manual Acceptance Checklist

Last generated: 2026-09-27

This checklist is generated from `apps/web/m4-gates.json`. Update that source file first when DEV-402/403/406 acceptance evidence changes.

Before recording manual evidence, run:

```bash
npm run acceptance:m4-browserless
```

Then open:

```text
http://127.0.0.1:4173/m4-acceptance.html
http://127.0.0.1:4173/billing.html
```

## DEV-402 结算金额与周期

Current state: Partial

Automatic evidence:
- [x] 储值单生成供应商应付
- [x] 信用账期半月周期
- [x] 直营账期预览为 DIRECT
- [x] 公司账期先收后付阻断

Manual evidence to collect:
- [ ] W09/S05/S08 四种结算模式截图
- [ ] 周期标签与付款状态复核

Manual acceptance path:
1. Account: `pxacc_admin`
   Entry: `billing.html`
   Action: 切换门店、供应商总单、供应商分店和直营账单视图，打开 PXACC 公司账期、储值、信用和直营数据
   Expected: 四种结算模式均显示正确金额，信用账期为 2026-09-16 半月周期，直营预览通道为 DIRECT
2. Account: `pxacc_admin`
   Entry: `billing.html`
   Action: 选择公司账期供应商应付明细并预览付款
   Expected: 门店应收未结清前，供应商付款预览被阻断

## DEV-403 账单家族与共享项

Current state: Partial

Automatic evidence:
- [x] 门店账单视图
- [x] 供应商总单视图
- [x] 供应商分店账单视图
- [x] 直营账单视图
- [x] 共享结算项显示待确认金额
- [x] 共享付款记录可见

Manual evidence to collect:
- [ ] 四类账单视图切换录屏
- [ ] 共享结算项不可重复付款复核

Manual acceptance path:
1. Account: `pxacc_admin`
   Entry: `billing.html`
   Action: 依次打开门店账单、供应商总单、供应商分店账单和直营账单，并展开各自明细
   Expected: 四类账单都能显示明细，储值供应商总单与分店单金额一致
2. Account: `pxacc_admin`
   Entry: `billing.html`
   Action: 查看 PXACC-PAY-SHARED 对应共享付款记录，再回到供应商总单和分店单
   Expected: 共享结算项显示 69.00 待确认/占用金额，不允许重复登记同一可用金额

## DEV-406 调整与差额处置

Current state: Partial

Automatic evidence:
- [x] W10 调整列表
- [x] W10 调整详情
- [x] 正调整可作为抵扣目标
- [x] 抵扣处置已创建
- [x] 收款方确认通过
- [x] 处置状态已确认

Manual evidence to collect:
- [ ] W10 列表/详情截图
- [ ] 离线返还、抵扣、收款确认录屏

Manual acceptance path:
1. Account: `pxacc_admin`
   Entry: `billing.html`
   Action: 打开 W10 账单调整与差额区，筛选待抵扣/返还，进入 PXACC-SO-STORED-ADJ-CREDIT 详情
   Expected: 负调整显示 -4.00，待处置金额 4.00，并能看到正调整抵扣目标
2. Account: `pxacc_admin`
   Entry: `billing.html`
   Action: 执行抵扣处置并完成收款方确认
   Expected: 处置方式为 OFFSET，状态到 CONFIRMED，调整项进入已处理状态

M4 remains open until the manual evidence boxes above are completed and reviewed alongside the browserless baseline.

