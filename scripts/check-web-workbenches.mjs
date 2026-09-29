import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing expected fragment: ${expected}`);
  }
}

function assertExists(path, label) {
  if (!existsSync(resolve(root, path))) {
    throw new Error(`${label} is missing: ${path}`);
  }
}

function checkSyntax(path) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, path)], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${path} failed syntax check:\n${result.stderr || result.stdout}`);
  }
}

const [billingHtml, billingJs, billingCss, appJs, appCss, productAppHtml, productAppMain, productAppApi, productAppShell, productAppState, productAppUi, productAppWorkflow, productOverviewPage, productFlowPage, productStorePage, productPurchaserPage, productSupplierPage, productFinancePage, reportHtml, mainFlowHtml, mainFlowJs, m4Html, m4Js, m4Css, m4Gates, mainFlowDemoHtml, mainFlowDemoJs, roleWorkbenchesHtml, roleWorkbenchesJs, storeWorkbenchHtml, storeWorkbenchJs, purchaserWorkbenchHtml, purchaserWorkbenchJs, supplierWorkbenchHtml, supplierWorkbenchJs, businessFlowHtml, businessFlowJs, mainFlowInteractiveCapture, opsHtml, opsJs, m6Html, m6Js, m6ReadinessScript] = await Promise.all([
  readProjectFile('apps/web/billing.html'),
  readProjectFile('apps/web/billing.js'),
  readProjectFile('apps/web/billing.css'),
  readProjectFile('apps/web/app.js'),
  readProjectFile('apps/web/style.css'),
  readProjectFile('apps/web/app.html'),
  readProjectFile('apps/web/product-app/main.js'),
  readProjectFile('apps/web/product-app/api.js'),
  readProjectFile('apps/web/product-app/shell.js'),
  readProjectFile('apps/web/product-app/state.js'),
  readProjectFile('apps/web/product-app/ui.js'),
  readProjectFile('apps/web/product-app/workflow.js'),
  readProjectFile('apps/web/product-app/pages/overview.js'),
  readProjectFile('apps/web/product-app/pages/flow.js'),
  readProjectFile('apps/web/product-app/pages/store.js'),
  readProjectFile('apps/web/product-app/pages/purchaser.js'),
  readProjectFile('apps/web/product-app/pages/supplier.js'),
  readProjectFile('apps/web/product-app/pages/finance.js'),
  readProjectFile('apps/web/index.html'),
  readProjectFile('apps/web/main-flow.html'),
  readProjectFile('apps/web/main-flow.js'),
  readProjectFile('apps/web/m4-acceptance.html'),
  readProjectFile('apps/web/m4-acceptance.js'),
  readProjectFile('apps/web/m4-acceptance.css'),
  readProjectFile('apps/web/m4-gates.json'),
  readProjectFile('apps/web/main-flow-demo.html'),
  readProjectFile('apps/web/main-flow-demo.js'),
  readProjectFile('apps/web/role-workbenches.html'),
  readProjectFile('apps/web/role-workbenches.js'),
  readProjectFile('apps/web/store-workbench.html'),
  readProjectFile('apps/web/store-workbench.js'),
  readProjectFile('apps/web/purchaser-workbench.html'),
  readProjectFile('apps/web/purchaser-workbench.js'),
  readProjectFile('apps/web/supplier-workbench.html'),
  readProjectFile('apps/web/supplier-workbench.js'),
  readProjectFile('apps/web/m7-business-flow.html'),
  readProjectFile('apps/web/m7-business-flow.js'),
  readProjectFile('scripts/capture-main-flow-interactive-demo.mjs'),
  readProjectFile('apps/web/ops.html'),
  readProjectFile('apps/web/ops.js'),
  readProjectFile('apps/web/m6-readiness.html'),
  readProjectFile('apps/web/m6-readiness.js'),
  readProjectFile('scripts/report-m6-readiness.mjs'),
]);

for (const path of [
  'apps/web/style.css',
  'apps/web/billing.css',
  'apps/web/app.html',
  'apps/web/product-app/main.js',
  'apps/web/product-app/api.js',
  'apps/web/product-app/shell.js',
  'apps/web/product-app/state.js',
  'apps/web/product-app/ui.js',
  'apps/web/product-app/workflow.js',
  'apps/web/product-app/pages/overview.js',
  'apps/web/product-app/pages/flow.js',
  'apps/web/product-app/pages/store.js',
  'apps/web/product-app/pages/purchaser.js',
  'apps/web/product-app/pages/supplier.js',
  'apps/web/product-app/pages/finance.js',
  'apps/web/billing.js',
  'apps/web/app.js',
  'apps/web/main-flow.html',
  'apps/web/main-flow.js',
  'apps/web/m4-acceptance.html',
  'apps/web/m4-acceptance.js',
  'apps/web/m4-acceptance.css',
  'apps/web/m4-gates.json',
  'apps/web/main-flow-demo.html',
  'apps/web/main-flow-demo.js',
  'apps/web/role-workbenches.html',
  'apps/web/role-workbenches.js',
  'apps/web/store-workbench.html',
  'apps/web/store-workbench.js',
  'apps/web/purchaser-workbench.html',
  'apps/web/purchaser-workbench.js',
  'apps/web/supplier-workbench.html',
  'apps/web/supplier-workbench.js',
  'apps/web/m7-business-flow.html',
  'apps/web/m7-business-flow.js',
  'apps/web/ops.html',
  'apps/web/ops.js',
  'apps/web/m6-readiness.html',
  'apps/web/m6-readiness.js',
  'docs/m6-wechat-device-evidence-guide.md',
  'docs/m6-production-runtime-guide.md',
  'docs/m6-storage-policy-guide.md',
]) {
  assertExists(path, 'web asset');
}

checkSyntax('apps/web/billing.js');
checkSyntax('apps/web/app.js');
checkSyntax('apps/web/product-app/main.js');
checkSyntax('apps/web/product-app/api.js');
checkSyntax('apps/web/product-app/shell.js');
checkSyntax('apps/web/product-app/state.js');
checkSyntax('apps/web/product-app/ui.js');
checkSyntax('apps/web/product-app/workflow.js');
checkSyntax('apps/web/product-app/pages/overview.js');
checkSyntax('apps/web/product-app/pages/flow.js');
checkSyntax('apps/web/product-app/pages/store.js');
checkSyntax('apps/web/product-app/pages/purchaser.js');
checkSyntax('apps/web/product-app/pages/supplier.js');
checkSyntax('apps/web/product-app/pages/finance.js');
checkSyntax('apps/web/main-flow.js');
checkSyntax('apps/web/m4-acceptance.js');
checkSyntax('apps/web/main-flow-demo.js');
checkSyntax('apps/web/role-workbenches.js');
checkSyntax('apps/web/store-workbench.js');
checkSyntax('apps/web/purchaser-workbench.js');
checkSyntax('apps/web/supplier-workbench.js');
checkSyntax('apps/web/m7-business-flow.js');
checkSyntax('apps/web/ops.js');
checkSyntax('apps/web/m6-readiness.js');
checkSyntax('scripts/report-m6-readiness.mjs');
checkSyntax('scripts/check-m6-initialization.mjs');
checkSyntax('scripts/check-m6-pilot.mjs');
checkSyntax('scripts/m6-wechat-evidence-lib.mjs');
checkSyntax('scripts/prepare-m6-wechat-device-evidence.mjs');
checkSyntax('scripts/check-m6-wechat-device-evidence.mjs');
checkSyntax('scripts/check-m6-production-runtime.mjs');
checkSyntax('scripts/check-m6-storage-policy.mjs');
checkSyntax('scripts/check-m6-external-evidence.mjs');
checkSyntax('scripts/write-m6-external-evidence-templates.mjs');
checkSyntax('scripts/capture-m6-readiness-evidence.mjs');
checkSyntax('scripts/package-m6-local-evidence.mjs');
checkSyntax('scripts/write-m6-local-handoff.mjs');
checkSyntax('scripts/write-m6-customer-evidence-request.mjs');

assertIncludes(billingHtml, '账单及付款', 'W09 billing page');
assertIncludes(billingHtml, '账单调整与差额', 'W10 adjustment page');
assertIncludes(billingHtml, 'id="bill-tabs"', 'W09 billing page');
assertIncludes(billingHtml, 'id="payment-actions"', 'W09 payment workflow');
assertIncludes(billingHtml, 'id="proof"', 'payment evidence upload');
assertIncludes(billingHtml, 'id="adjustments"', 'W10 adjustment list');
assertIncludes(billingHtml, 'id="adjustment-detail"', 'W10 adjustment detail');

assertIncludes(billingJs, 'store-statements', 'W09 statement endpoints');
assertIncludes(billingJs, 'supplier-statements', 'W09 statement endpoints');
assertIncludes(billingJs, 'supplier-store-statements', 'W09 statement endpoints');
assertIncludes(billingJs, 'direct-statements', 'W09 statement endpoints');
assertIncludes(billingJs, '/payment-records/preview', 'payment preview workflow');
assertIncludes(billingJs, '/payment-records', 'payment registration workflow');
assertIncludes(billingJs, '/files/upload-sessions', 'payment evidence workflow');
assertIncludes(billingJs, '/adjustments', 'W10 adjustment workflow');
assertIncludes(billingJs, '/difference-disposals', 'W10 difference disposal workflow');
assertIncludes(billingJs, 'OFFLINE_RETURN', 'W10 offline return workflow');
assertIncludes(billingJs, 'OFFSET', 'W10 offset workflow');

assertIncludes(billingCss, '.bill-tabs', 'billing styles');
assertIncludes(billingCss, '.adjustment-detail', 'adjustment styles');
assertIncludes(billingCss, '@media', 'responsive billing styles');

assertIncludes(productAppHtml, 'product-app/main.js', 'product app module entry');
assertIncludes(productAppHtml, 'id="product-app"', 'product app mount point');
assertIncludes(productAppMain, "import * as store", 'product app store module import');
assertIncludes(productAppMain, "import * as flow", 'product app flow module import');
assertIncludes(productAppMain, "import * as purchaser", 'product app purchaser module import');
assertIncludes(productAppMain, "import * as supplier", 'product app supplier module import');
assertIncludes(productAppMain, "import * as finance", 'product app finance module import');
assertIncludes(productAppMain, 'hashchange', 'product app client route listener');
assertIncludes(productAppApi, 'apiBase', 'product app shared api base');
assertIncludes(productAppApi, '/auth/login', 'product app shared login');
assertIncludes(productAppShell, "['store', '门店']", 'product app store route');
assertIncludes(productAppShell, "['flow', '业务流转']", 'product app flow route');
assertIncludes(productAppShell, "['purchaser', '采购']", 'product app purchaser route');
assertIncludes(productAppShell, "['supplier', '供应商']", 'product app supplier route');
assertIncludes(productAppShell, "['finance', '财务']", 'product app finance route');
assertIncludes(productAppShell, '返回业务总览', 'product app role route return navigation');
assertIncludes(productAppShell, '/store-workbench.html', 'product app legacy store link');
assertIncludes(productAppState, 'main-flow-demo-seed.json', 'product app seed state loader');
assertIncludes(productAppState, 'm6-readiness.json', 'product app readiness state loader');
assertIncludes(productAppWorkflow, 'procurex-product-app-workflow', 'product app workflow storage key');
assertIncludes(productAppWorkflow, 'saveWorkflowContext', 'product app workflow save helper');
assertIncludes(productAppWorkflow, 'refreshWorkflowContext', 'product app workflow API refresh helper');
assertIncludes(productAppWorkflow, 'workflowNextAction', 'product app workflow next action helper');
assertIncludes(productAppWorkflow, 'PENDING_PROCUREMENT', 'product app purchaser next action state');
assertIncludes(productAppWorkflow, '采购处理供应商拒单', 'product app supplier rejection next action');
assertIncludes(productOverviewPage, '流程交接', 'product app overview workflow handoff');
assertIncludes(productOverviewPage, '刷新交接状态', 'product app overview workflow refresh action');
assertIncludes(productOverviewPage, '/purchase-requests/${workflow.purchaseRequestId}', 'product app overview refresh purchase request');
assertIncludes(productOverviewPage, '/supplier-orders/${workflow.supplierOrderId}', 'product app overview refresh supplier order');
assertIncludes(productOverviewPage, '/shipments/${workflow.shipmentId}', 'product app overview refresh shipment');
assertIncludes(productOverviewPage, '/payment-records/${workflow.paymentId}', 'product app overview refresh payment');
assertIncludes(productOverviewPage, '下一步处理', 'product app overview workflow next action');
assertIncludes(productOverviewPage, '付款状态', 'product app overview payment status');
assertIncludes(productOverviewPage, '组件化迁移状态', 'product app migration status');
assertIncludes(productOverviewPage, '今日角色证据', 'product app role evidence overview');
assertIncludes(productOverviewPage, '下一步推进', 'product app next-step overview');
assertIncludes(productOverviewPage, '产品化与上线状态', 'product app launch status overview');
assertIncludes(productOverviewPage, '#/flow', 'product app flow route card');
assertIncludes(productOverviewPage, '#/finance', 'product app finance route card');
assertIncludes(productFlowPage, '一键执行业务流转', 'product app flow run action');
assertIncludes(productFlowPage, 'saveWorkflowContext', 'product app flow workflow handoff save');
assertIncludes(productFlowPage, 'purchaseRequestStatus: confirmed.status', 'product app flow request state handoff');
assertIncludes(productFlowPage, 'receiptRevision: flowState.receipt.revision', 'product app flow receipt revision handoff');
assertIncludes(productFlowPage, 'app-workflow-handoff', 'product app flow workflow handoff panel');
assertIncludes(productFlowPage, '/purchase-requests/preview', 'product app flow preview endpoint');
assertIncludes(productFlowPage, '/purchase-requests/${requestDetail.id}/confirm', 'product app flow confirm endpoint');
assertIncludes(productFlowPage, '/supplier-orders/${supplierDetail.id}/shipments', 'product app flow shipment endpoint');
assertIncludes(productFlowPage, '/shipments/${shipmentDetail.id}/receipts', 'product app flow receipt endpoint');
assertIncludes(productFlowPage, 'expectedOrderVersion', 'product app flow receipt version guard');
assertIncludes(productFlowPage, '一键执行异常分支', 'product app exception action');
assertIncludes(productFlowPage, '/supplier-orders/${rejectedFlow.supplierOrderId}/reject', 'product app supplier rejection endpoint');
assertIncludes(productFlowPage, '/purchase-requests/${rejectedFlow.requestId}/reallocate', 'product app purchaser reallocation endpoint');
assertIncludes(productFlowPage, "action: 'ACCEPT'", 'product app discrepancy accept branch');
assertIncludes(productFlowPage, "action: 'REPLENISH'", 'product app discrepancy replenish branch');
assertIncludes(productFlowPage, "action: 'RETURN'", 'product app discrepancy return branch');
assertIncludes(productStorePage, '/stores/${state.seed.storeId}/account', 'product app store account endpoint');
assertIncludes(productStorePage, '/purchase-requests/preview', 'product app store order preview endpoint');
assertIncludes(productStorePage, '/purchase-requests', 'product app store order endpoint');
assertIncludes(productStorePage, '/shipments/${shipmentId}', 'product app store shipment detail endpoint');
assertIncludes(productStorePage, 'workflow?.shipmentId', 'product app store workflow shipment prefill');
assertIncludes(productStorePage, 'receiptStatus: receiptRevision > 0 ?', 'product app store refresh receipt status handoff');
assertIncludes(productStorePage, '刷新发货单', 'product app store route refresh action');
assertIncludes(productStorePage, '/shipments/${shipment.id}/receipts', 'product app store receipt endpoint');
assertIncludes(productStorePage, '完整收货', 'product app store receipt action');
assertIncludes(productStorePage, "purchaseRequestStatus: created.status || 'PENDING_PROCUREMENT'", 'product app store order workflow handoff');
assertIncludes(productStorePage, 'receiptId: receipt.id', 'product app store receipt workflow handoff');
assertIncludes(productPurchaserPage, '/purchase-requests/${requestId}', 'product app purchaser request detail endpoint');
assertIncludes(productPurchaserPage, 'workflow?.purchaseRequestId', 'product app purchaser workflow request prefill');
assertIncludes(productPurchaserPage, 'purchaseRequestStatus: detail.status', 'product app purchaser refresh status handoff');
assertIncludes(productPurchaserPage, '刷新采购申请', 'product app purchaser route refresh action');
assertIncludes(productPurchaserPage, '/purchase-requests/${detail.id}/confirm', 'product app purchaser confirm endpoint');
assertIncludes(productPurchaserPage, '/purchase-requests/${detail.id}/reallocate', 'product app purchaser reallocate endpoint');
assertIncludes(productPurchaserPage, 'app-request-items', 'product app purchaser request item table');
assertIncludes(productPurchaserPage, '处理结果', 'product app purchaser action result panel');
assertIncludes(productPurchaserPage, '供应商单', 'product app purchaser confirm result');
assertIncludes(productPurchaserPage, 'supplierOrderId,', 'product app purchaser confirmation workflow handoff');
assertIncludes(productPurchaserPage, 'reallocated.status || \'REALLOCATED\'', 'product app purchaser reallocation workflow handoff');
assertIncludes(productSupplierPage, '/supplier-orders/${id}', 'product app supplier detail endpoint');
assertIncludes(productSupplierPage, 'workflow?.supplierOrderId', 'product app supplier workflow order prefill');
assertIncludes(productSupplierPage, '/supplier-orders/${order.id}/shipments', 'product app supplier shipment endpoint');
assertIncludes(productSupplierPage, '/supplier-orders/${order.id}/reject', 'product app supplier reject endpoint');
assertIncludes(productSupplierPage, '/discrepancies/${id}/resolve', 'product app supplier discrepancy endpoint');
assertIncludes(productSupplierPage, '/payment-records/${id}', 'product app supplier payment detail endpoint');
assertIncludes(productSupplierPage, '/payment-records/${payment.id}/confirm', 'product app supplier payment confirm endpoint');
assertIncludes(productSupplierPage, '/payment-records/${payment.id}/reject', 'product app supplier payment reject endpoint');
assertIncludes(productSupplierPage, '确认收款', 'product app supplier payment confirm action');
assertIncludes(productSupplierPage, 'paymentStatus', 'product app supplier workflow payment status save');
assertIncludes(productSupplierPage, 'supplierOrderStatus: order.status', 'product app supplier order refresh status handoff');
assertIncludes(productSupplierPage, '刷新供应商单', 'product app supplier route refresh action');
assertIncludes(productSupplierPage, '刷新付款', 'product app supplier payment refresh action');
assertIncludes(productSupplierPage, 'shipmentId: shipment.id', 'product app supplier shipment workflow handoff');
assertIncludes(productSupplierPage, "supplierOrderStatus: 'REJECTED'", 'product app supplier rejection workflow handoff');
assertIncludes(productFinancePage, '/supplier-statements', 'product app finance supplier statements endpoint');
assertIncludes(productFinancePage, '/supplier-statements/${statementId}', 'product app finance supplier statement detail endpoint');
assertIncludes(productFinancePage, '/store-statements', 'product app finance store statements endpoint');
assertIncludes(productFinancePage, '/payment-records?direction=COMPANY_TO_SUPPLIER', 'product app finance payment list endpoint');
assertIncludes(productFinancePage, 'workflow?.paymentId', 'product app finance workflow payment prefill');
assertIncludes(productFinancePage, 'saveWorkflowContext', 'product app finance workflow payment save');
assertIncludes(productFinancePage, 'paymentStatus: payment.status', 'product app finance payment refresh status handoff');
assertIncludes(productFinancePage, '刷新付款', 'product app finance route refresh action');
assertIncludes(productFinancePage, '/payment-records/preview', 'product app finance payment preview endpoint');
assertIncludes(productFinancePage, '/files/upload-sessions', 'product app finance payment evidence upload endpoint');
assertIncludes(productFinancePage, "request('/payment-records'", 'product app finance payment create endpoint');
assertIncludes(productFinancePage, '/payment-records/${payment.id}/confirm', 'product app finance payment confirm endpoint');
assertIncludes(productFinancePage, '/payment-records/${payment.id}/reject', 'product app finance payment reject endpoint');
assertIncludes(productFinancePage, '登记付款待确认', 'product app finance pending payment action');
assertIncludes(productFinancePage, "paymentStatus: payment.status || 'PENDING'", 'product app finance pending payment workflow handoff');
assertIncludes(productFinancePage, '登记并确认供应商付款', 'product app finance deterministic payment action');
assertIncludes(productFinancePage, '登记并驳回供应商付款', 'product app finance deterministic rejection action');
assertIncludes(productFinancePage, '读取账单', 'product app finance statement detail action');
assertIncludes(productFinancePage, 'app-statement-lines', 'product app finance statement lines table');
assertIncludes(productFinancePage, 'app-payment-allocations', 'product app finance payment allocations table');
assertIncludes(mainFlowInteractiveCapture, 'product-app-finance-reject-action.png', 'product app finance rejection evidence capture');
assertIncludes(mainFlowInteractiveCapture, 'productAppFinanceRejectAction', 'product app finance rejection manifest state');
assertIncludes(mainFlowInteractiveCapture, 'runProductAppFinancePendingAction', 'product app pending payment handoff browser evidence');
assertIncludes(mainFlowInteractiveCapture, 'overviewRecommendsSupplier', 'product app pending payment next action evidence');
assertIncludes(mainFlowInteractiveCapture, 'overviewRefreshNotice', 'product app workflow API refresh evidence');
assertIncludes(mainFlowInteractiveCapture, 'productAppWorkflowRefreshFlowAction', 'product app refresh evidence uses current workflow IDs');
assertIncludes(mainFlowInteractiveCapture, "journey.push('PURCHASER')", 'product app guided purchaser handoff evidence');
assertIncludes(mainFlowInteractiveCapture, "journey.push('SUPPLIER_PAYMENT')", 'product app guided supplier payment evidence');
assertIncludes(mainFlowInteractiveCapture, "finalOverviewShowsCompleted", 'product app guided journey completion on overview');
assertIncludes(mainFlowInteractiveCapture, "productAppFinancePendingActionScreenshot", 'product app guided journey screenshot manifest');
assertIncludes(appCss, '.app-route-grid', 'product app route grid styles');

assertIncludes(reportHtml, '报表与分析', 'W11 report page');
assertIncludes(reportHtml, '/app.html', 'product app navigation entry');
assertIncludes(reportHtml, '/ops.html', 'W13 navigation entry');
assertIncludes(reportHtml, '/store-workbench.html', 'M7 store workbench navigation entry');
assertIncludes(reportHtml, '/purchaser-workbench.html', 'M7 purchaser workbench navigation entry');
assertIncludes(reportHtml, '/supplier-workbench.html', 'M7 supplier workbench navigation entry');
assertIncludes(reportHtml, '/m7-business-flow.html', 'M7 business flow navigation entry');
assertIncludes(reportHtml, '/m6-readiness.html', 'M6 readiness navigation entry');
assertIncludes(reportHtml, 'M5 验收状态', 'M5 acceptance summary');
assertIncludes(reportHtml, 'id="m5-acceptance"', 'M5 acceptance summary');
assertIncludes(reportHtml, 'M5 环境状态', 'M5 status summary');
assertIncludes(reportHtml, 'id="m5-status"', 'M5 status summary');
assertIncludes(reportHtml, 'M5 收口状态', 'M5 gate status summary');
assertIncludes(reportHtml, 'id="m5-gate-status"', 'M5 gate status summary');
assertIncludes(reportHtml, 'id="export-jobs"', 'R04 export job list');
assertIncludes(appJs, '/reports/${active}', 'W11 report endpoints');
assertIncludes(appJs, '/exports', 'R04 export workflow');
assertIncludes(appJs, '/retry', 'DEV-505 export retry workflow');
assertIncludes(appJs, 'loadExportJobs', 'R04 export job list');
assertIncludes(appJs, 'data-export-retry', 'DEV-505 export retry button');
assertIncludes(appJs, 'reports-acceptance-run.json', 'M5 acceptance summary output');
assertIncludes(appJs, 'm5-status.json', 'M5 status summary output');
assertIncludes(appJs, 'm5-gate-status.json', 'M5 gate status summary output');
assertIncludes(appJs, 'loadAcceptance', 'M5 acceptance summary loader');
assertIncludes(appJs, 'loadM5Status', 'M5 status summary loader');
assertIncludes(appJs, 'loadM5GateStatus', 'M5 gate status summary loader');
assertIncludes(appCss, '.acceptance-list', 'M5 acceptance summary styles');
assertIncludes(appCss, '.export-card', 'R04 export job list styles');
assertIncludes(appCss, '@media(max-width:720px)', 'mobile workbench styles');
assertIncludes(appCss, 'min-width:0', 'mobile workbench body width reset');
assertIncludes(packageJson.scripts['billing:seed-acceptance'], 'seed-billing-acceptance.mjs', 'billing acceptance seed script');
assertIncludes(packageJson.scripts['billing:check-acceptance'], 'check-billing-acceptance.mjs', 'billing acceptance check script');
assertIncludes(packageJson.scripts['reports:seed-acceptance'], 'seed-reports-acceptance.mjs', 'reports acceptance seed script');
assertIncludes(packageJson.scripts['reports:check-acceptance'], 'check-reports-acceptance.mjs', 'reports acceptance check script');
assertIncludes(packageJson.scripts['acceptance:m5-browserless'], 'reports:check-acceptance', 'M5 browserless acceptance script');
assertIncludes(packageJson.scripts['m5:capture-browser-evidence'], 'capture-m5-browser-evidence.mjs', 'M5 browser evidence capture script');
assertIncludes(packageJson.scripts['m5:capture-all-evidence'], 'capture-m5-all-evidence.mjs', 'M5 browser evidence refresh script');
assertIncludes(packageJson.scripts['m5:status'], 'report-m5-status.mjs', 'M5 status report script');
assertIncludes(packageJson.scripts['m5:gate-status'], 'check-m5-gate-status.mjs', 'M5 gate status script');
assertIncludes(packageJson.scripts['m6:readiness'], 'report-m6-readiness.mjs', 'M6 readiness script');
assertIncludes(packageJson.scripts['m6:readiness:strict'], '--strict', 'M6 strict readiness script');
assertIncludes(packageJson.scripts['m6:initialization-check'], 'check-m6-initialization.mjs', 'M6 initialization script');
assertIncludes(packageJson.scripts['m6:pilot-check'], 'check-m6-pilot.mjs', 'M6 pilot script');
assertIncludes(packageJson.scripts['m6:prepare-wechat-evidence'], 'prepare-m6-wechat-device-evidence.mjs', 'M6 WeChat evidence draft script');
assertIncludes(packageJson.scripts['m6:check-wechat-evidence'], 'check-m6-wechat-device-evidence.mjs', 'M6 WeChat evidence check script');
assertIncludes(packageJson.scripts['m6:check-production-runtime'], 'check-m6-production-runtime.mjs', 'M6 production runtime check script');
assertIncludes(packageJson.scripts['m6:check-storage-policy'], 'check-m6-storage-policy.mjs', 'M6 storage policy check script');
assertIncludes(packageJson.scripts['m6:external-evidence'], 'check-m6-external-evidence.mjs', 'M6 external evidence script');
assertIncludes(packageJson.scripts['m6:external-evidence:strict'], '--strict', 'M6 strict external evidence script');
assertIncludes(packageJson.scripts['m6:write-external-templates'], 'write-m6-external-evidence-templates.mjs', 'M6 external evidence template writer');
assertIncludes(packageJson.scripts['m6:check-external-templates'], '--check', 'M6 external evidence template check');
assertIncludes(packageJson.scripts['m6:capture-readiness-evidence'], 'capture-m6-readiness-evidence.mjs', 'M6 readiness browser evidence capture');
assertIncludes(packageJson.scripts['m6:package-local-evidence'], 'package-m6-local-evidence.mjs', 'M6 local evidence package');
assertIncludes(packageJson.scripts['m6:write-local-handoff'], 'write-m6-local-handoff.mjs', 'M6 local handoff writer');
assertIncludes(packageJson.scripts['m6:check-local-handoff'], '--check', 'M6 local handoff check');
assertIncludes(packageJson.scripts['m6:write-customer-evidence-request'], 'write-m6-customer-evidence-request.mjs', 'M6 customer evidence request writer');
assertIncludes(packageJson.scripts['m6:check-customer-evidence-request'], '--check', 'M6 customer evidence request check');
assertIncludes(packageJson.scripts['acceptance:m5-close'], 'm5:gate-status', 'M5 close acceptance script');
assertIncludes(packageJson.scripts['acceptance:m5-close'], 'main-flow:check-demo', 'M5 close acceptance script');
assertIncludes(packageJson.scripts['acceptance:m5-close'], 'm5:capture-all-evidence', 'M5 close acceptance script');
assertIncludes(packageJson.scripts['acceptance:m5-close'], 'main-flow:capture-demo-evidence', 'M5 close acceptance script');
assertIncludes(packageJson.scripts['acceptance:m5-close'], 'main-flow:capture-interactive-demo', 'M5 close acceptance script');
assertIncludes(packageJson.scripts['db:check'], 'check-local-db.mjs', 'local database check script');
assertIncludes(packageJson.scripts['acceptance:m4-browserless'], 'billing:check-acceptance', 'M4 browserless acceptance script');
assertIncludes(packageJson.scripts['acceptance:m4-close'], 'm4:check-manual-evidence', 'M4 close acceptance script');
assertIncludes(packageJson.scripts['m4:check-browser-runtime'], 'check-browser-runtime.mjs', 'M4 browser runtime check script');
assertIncludes(packageJson.scripts['m4:capture-browser-evidence'], 'capture-m4-browser-evidence.mjs', 'M4 browser evidence capture script');
assertIncludes(packageJson.scripts['m4:capture-manual-evidence'], 'capture-m4-manual-evidence.mjs', 'M4 manual evidence capture script');
assertIncludes(packageJson.scripts['m4:manual-evidence-status'], 'check-m4-manual-evidence.mjs', 'M4 manual evidence status script');
assertIncludes(packageJson.scripts['m4:check-manual-evidence'], 'check-m4-manual-evidence.mjs', 'M4 manual evidence check script');
assertIncludes(packageJson.scripts['m4:prepare-manual-acceptance'], 'prepare-m4-manual-acceptance.mjs', 'M4 manual acceptance prep script');
assertIncludes(packageJson.scripts['m4:status'], 'report-m4-status.mjs', 'M4 status report script');
assertIncludes(packageJson.scripts['m4:start-manual-acceptance'], 'start-m4-manual-acceptance.mjs', 'M4 manual acceptance launcher script');
assertIncludes(packageJson.scripts['m4:gate-status'], 'check-m4-gate-status.mjs', 'M4 gate status script');
assertIncludes(packageJson.scripts['m4:write-manual-checklist'], 'write-m4-manual-checklist.mjs', 'M4 manual checklist script');
assertIncludes(packageJson.scripts['m4:check-manual-checklist'], '--check', 'M4 manual checklist check script');
assertIncludes(packageJson.scripts['acceptance:m4-browserless'], 'm4:gate-status', 'M4 browserless acceptance script');
assertIncludes(packageJson.scripts['acceptance:m4-browserless'], 'm4:check-manual-checklist', 'M4 browserless acceptance script');
assertIncludes(packageJson.scripts['acceptance:m4-browserless'], 'acceptance:main-flow', 'M4 browserless acceptance script');
assertIncludes(packageJson.scripts['main-flow:seed-demo'], 'seed-main-flow-demo.mjs', 'main-flow demo seed script');
assertIncludes(packageJson.scripts['main-flow:check-demo'], 'check-main-flow-demo.mjs', 'main-flow demo check script');
assertIncludes(packageJson.scripts['main-flow:capture-demo-evidence'], 'capture-main-flow-demo-evidence.mjs', 'main-flow demo browser evidence capture script');
assertIncludes(packageJson.scripts['main-flow:capture-interactive-demo'], 'capture-main-flow-interactive-demo.mjs', 'main-flow interactive browser evidence capture script');
assertIncludes(mainFlowInteractiveCapture, 'main-flow-demo-interactive-mobile.png', 'main-flow mobile interactive evidence capture');
assertIncludes(mainFlowInteractiveCapture, 'm7-business-flow.png', 'M7 business flow desktop evidence capture');
assertIncludes(mainFlowInteractiveCapture, 'm7-business-flow-mobile.png', 'M7 business flow mobile evidence capture');
assertIncludes(mainFlowInteractiveCapture, 'businessFlow', 'M7 business flow manifest state');
assertIncludes(mainFlowInteractiveCapture, 'Emulation.setDeviceMetricsOverride', 'main-flow mobile viewport evidence capture');
assertIncludes(packageJson.scripts['acceptance:m4-browserless'], 'main-flow:check-demo', 'M4 browserless acceptance script');

assertIncludes(mainFlowHtml, '主流程验收', 'main-flow acceptance page');
assertIncludes(mainFlowHtml, '/main-flow.js', 'main-flow acceptance script');
assertIncludes(mainFlowJs, 'main-flow-run.json', 'main-flow runner output');
assertIncludes(mainFlowJs, 'totalPayableAmount', 'main-flow payment preview evidence');
assertIncludes(mainFlowJs, 'fulfillmentStatus', 'main-flow receipt completion evidence');

assertIncludes(m4Html, 'M4 验收', 'M4 acceptance page');
assertIncludes(m4Html, '/m4-acceptance.js', 'M4 acceptance script');
assertIncludes(m4Html, '/m4-acceptance.css', 'M4 acceptance styles');
assertIncludes(m4Js, 'billing-acceptance-run.json', 'M4 billing acceptance output');
assertIncludes(m4Js, 'main-flow-run.json', 'M4 main-flow acceptance output');
assertIncludes(m4Js, 'm4-gates.json', 'M4 gate definitions');
assertIncludes(m4Js, 'acceptance:m4-browserless', 'M4 acceptance command');
assertIncludes(m4Js, 'collectEvidence', 'M4 gate evidence mapping');
assertIncludes(m4Js, 'localStorage', 'M4 manual evidence checklist');
assertIncludes(m4Js, 'data-manual-evidence', 'M4 manual evidence checklist');
assertIncludes(m4Js, 'renderEvidenceSummary', 'M4 evidence summary');
assertIncludes(m4Js, 'navigator.clipboard', 'M4 evidence summary copy');
assertIncludes(m4Js, 'renderManualPlan', 'M4 manual acceptance plan');
assertIncludes(m4Gates, 'DEV-402', 'M4 gate definitions');
assertIncludes(m4Gates, 'DEV-403', 'M4 gate definitions');
assertIncludes(m4Gates, 'DEV-406', 'M4 gate definitions');
assertIncludes(m4Gates, 'stored-value-payable', 'M4 structured gate evidence');
assertIncludes(m4Gates, 'manualSteps', 'M4 manual acceptance plan');
assertIncludes(m4Css, '.gate-card', 'M4 gate styles');
assertIncludes(m4Css, '.passed', 'M4 gate evidence styles');
assertIncludes(m4Css, '.manual-check', 'M4 manual evidence styles');
assertIncludes(m4Css, '.evidence-card', 'M4 evidence summary styles');
assertIncludes(m4Css, '.manual-plan', 'M4 manual acceptance plan styles');

assertIncludes(mainFlowDemoHtml, '主流程操作台', 'main-flow demo page');
assertIncludes(mainFlowDemoHtml, '/main-flow-demo.js', 'main-flow demo script');
assertIncludes(mainFlowDemoHtml, '/role-workbenches.html', 'role workbench navigation');
assertIncludes(mainFlowDemoHtml, '角色复核', 'main-flow demo role evidence card');
assertIncludes(mainFlowDemoHtml, '分角色视图', 'main-flow demo role view card');
assertIncludes(mainFlowDemoHtml, '主流程证据', 'main-flow demo evidence card');
assertIncludes(mainFlowDemoHtml, '一键执行', 'main-flow demo run-all control');
assertIncludes(mainFlowDemoJs, 'main-flow-demo-seed.json', 'main-flow demo seed output');
assertIncludes(mainFlowDemoJs, 'main-flow-demo-run.json', 'main-flow demo evidence output');
assertIncludes(mainFlowDemoJs, 'roleEvidence', 'main-flow demo role evidence loader');
assertIncludes(mainFlowDemoJs, 'roleAccounts', 'main-flow demo role seed accounts');
assertIncludes(mainFlowDemoJs, 'renderRoleView', 'main-flow demo role view renderer');
assertIncludes(mainFlowDemoJs, '下一步工作台边界', 'main-flow demo role next-work boundary');
assertIncludes(mainFlowDemoJs, 'loadDemoEvidence', 'main-flow demo evidence loader');
assertIncludes(mainFlowDemoJs, 'runAll', 'main-flow demo run-all workflow');
assertIncludes(mainFlowDemoJs, '/purchase-requests', 'main-flow demo purchase request call');
assertIncludes(mainFlowDemoJs, '/shipments/', 'main-flow demo receipt call');

assertIncludes(roleWorkbenchesHtml, '角色工作台', 'role workbenches page');
assertIncludes(roleWorkbenchesHtml, '/role-workbenches.js', 'role workbenches script');
assertIncludes(roleWorkbenchesHtml, '门店、采购、供应商工作台', 'role workbenches heading');
assertIncludes(roleWorkbenchesHtml, 'id="role-lanes"', 'role workbenches lane grid');
assertIncludes(roleWorkbenchesHtml, 'id="role-detail"', 'role workbenches detail grid');
assertIncludes(roleWorkbenchesHtml, 'id="role-actions"', 'role workbenches real action panel');
assertIncludes(roleWorkbenchesHtml, 'id="evidence-map"', 'role workbenches evidence map');
assertIncludes(roleWorkbenchesJs, 'main-flow-demo-seed.json', 'role workbenches seed loader');
assertIncludes(roleWorkbenchesJs, 'main-flow-demo-run.json', 'role workbenches evidence loader');
assertIncludes(roleWorkbenchesJs, '/purchase-requests/preview', 'role workbenches store order preview');
assertIncludes(roleWorkbenchesJs, '/purchase-requests', 'role workbenches store order creation');
assertIncludes(roleWorkbenchesJs, '/confirm', 'role workbenches purchaser confirmation');
assertIncludes(roleWorkbenchesJs, '/shipment-preview', 'role workbenches supplier shipment preview');
assertIncludes(roleWorkbenchesJs, '/shipments', 'role workbenches supplier shipment creation');
assertIncludes(roleWorkbenchesJs, '/receipts', 'role workbenches store receipt creation');
assertIncludes(roleWorkbenchesJs, '/discrepancies/${discrepancyId}/resolve', 'role workbenches supplier discrepancy resolution');
assertIncludes(roleWorkbenchesJs, '/reject', 'role workbenches supplier rejection');
assertIncludes(roleWorkbenchesJs, '/reallocate', 'role workbenches purchaser rejection handling');
assertIncludes(roleWorkbenchesJs, 'secondarySupplierId', 'role workbenches multi-supplier reallocation');
assertIncludes(roleWorkbenchesJs, "action: 'REPLENISH'", 'role workbenches discrepancy replenishment branch');
assertIncludes(roleWorkbenchesJs, "action: 'RETURN'", 'role workbenches discrepancy return branch');
assertIncludes(roleWorkbenchesJs, 'store-order-action', 'role workbenches store action button');
assertIncludes(roleWorkbenchesJs, 'purchaser-confirm-action', 'role workbenches purchaser action button');
assertIncludes(roleWorkbenchesJs, 'supplier-shipment-action', 'role workbenches supplier shipment action button');
assertIncludes(roleWorkbenchesJs, 'store-receipt-action', 'role workbenches store receipt action button');
assertIncludes(roleWorkbenchesJs, 'supplier-discrepancy-action', 'role workbenches supplier discrepancy action button');
assertIncludes(roleWorkbenchesJs, 'supplier-rejection-action', 'role workbenches supplier rejection action button');
assertIncludes(roleWorkbenchesJs, 'supplier-discrepancy-branches-action', 'role workbenches supplier discrepancy branch action button');
assertIncludes(roleWorkbenchesJs, '门店工作台', 'role workbenches store lane');
assertIncludes(roleWorkbenchesJs, '采购工作台', 'role workbenches purchaser lane');
assertIncludes(roleWorkbenchesJs, '供应商工作台', 'role workbenches supplier lane');
assertIncludes(roleWorkbenchesJs, '下一步页面边界', 'role workbenches next page boundary');
assertIncludes(roleWorkbenchesJs, 'roleEvidence', 'role workbenches role evidence mapping');

assertIncludes(storeWorkbenchHtml, '门店日常工作台', 'M7 store workbench page');
assertIncludes(storeWorkbenchHtml, '/store-workbench.js', 'M7 store workbench script');
assertIncludes(storeWorkbenchHtml, 'id="store-summary"', 'M7 store summary');
assertIncludes(storeWorkbenchHtml, 'id="store-order-form"', 'M7 store order form');
assertIncludes(storeWorkbenchHtml, 'id="store-account"', 'M7 store account panel');
assertIncludes(storeWorkbenchHtml, 'id="store-orders"', 'M7 store order list');
assertIncludes(storeWorkbenchHtml, 'id="store-notifications"', 'M7 store notifications');
assertIncludes(storeWorkbenchHtml, 'id="store-receipt"', 'M7 store receipt panel');
assertIncludes(storeWorkbenchHtml, '/m7-business-flow.html', 'M7 store business flow navigation');
assertIncludes(storeWorkbenchJs, 'main-flow-demo-seed.json', 'M7 store seed loader');
assertIncludes(storeWorkbenchJs, '/auth/login', 'M7 store login');
assertIncludes(storeWorkbenchJs, '/stores/${storeId}/account', 'M7 store account endpoint');
assertIncludes(storeWorkbenchJs, '/stores/${storeId}/ledgers', 'M7 store ledgers endpoint');
assertIncludes(storeWorkbenchJs, '/purchase-requests/preview', 'M7 store order preview endpoint');
assertIncludes(storeWorkbenchJs, '/purchase-requests', 'M7 store order endpoints');
assertIncludes(storeWorkbenchJs, '/notifications', 'M7 store notification endpoint');
assertIncludes(storeWorkbenchJs, '/shipments/${shipmentId}', 'M7 store shipment detail endpoint');
assertIncludes(storeWorkbenchJs, '/shipments/${state.shipment.id}/receipts', 'M7 store receipt endpoint');
assertIncludes(storeWorkbenchJs, 'store-workbench-order-', 'M7 store idempotent order key');
assertIncludes(storeWorkbenchJs, 'store-workbench-receipt-', 'M7 store idempotent receipt key');

assertIncludes(purchaserWorkbenchHtml, '采购日常工作台', 'M7 purchaser workbench page');
assertIncludes(purchaserWorkbenchHtml, '/purchaser-workbench.js', 'M7 purchaser workbench script');
assertIncludes(purchaserWorkbenchHtml, 'id="purchaser-summary"', 'M7 purchaser summary');
assertIncludes(purchaserWorkbenchHtml, 'id="purchase-requests"', 'M7 purchaser request list');
assertIncludes(purchaserWorkbenchHtml, 'id="rejection-todos"', 'M7 purchaser rejection todos');
assertIncludes(purchaserWorkbenchHtml, 'id="request-detail"', 'M7 purchaser request detail');
assertIncludes(purchaserWorkbenchHtml, 'id="reallocate-result"', 'M7 purchaser reallocate result');
assertIncludes(purchaserWorkbenchHtml, '/store-workbench.html', 'M7 purchaser store navigation');
assertIncludes(purchaserWorkbenchHtml, '/m7-business-flow.html', 'M7 purchaser business flow navigation');
assertIncludes(purchaserWorkbenchJs, 'main-flow-demo-seed.json', 'M7 purchaser seed loader');
assertIncludes(purchaserWorkbenchJs, '/auth/login', 'M7 purchaser login');
assertIncludes(purchaserWorkbenchJs, '/purchase-requests', 'M7 purchaser request list endpoint');
assertIncludes(purchaserWorkbenchJs, '/notifications', 'M7 purchaser notification endpoint');
assertIncludes(purchaserWorkbenchJs, '/purchase-requests/${requestId}', 'M7 purchaser request detail endpoint');
assertIncludes(purchaserWorkbenchJs, '/purchase-requests/${state.detail.id}/confirm', 'M7 purchaser confirm endpoint');
assertIncludes(purchaserWorkbenchJs, '/purchase-requests/${state.detail.id}/reallocate', 'M7 purchaser reallocate endpoint');
assertIncludes(purchaserWorkbenchJs, 'SUPPLIER_ORDER_REJECTED', 'M7 purchaser rejection notification filter');
assertIncludes(purchaserWorkbenchJs, 'secondarySupplierId', 'M7 purchaser backup supplier');
assertIncludes(purchaserWorkbenchJs, 'purchaser-workbench-confirm-', 'M7 purchaser idempotent confirm key');
assertIncludes(purchaserWorkbenchJs, 'purchaser-workbench-reallocate-', 'M7 purchaser idempotent reallocate key');

assertIncludes(supplierWorkbenchHtml, '供应商日常工作台', 'M7 supplier workbench page');
assertIncludes(supplierWorkbenchHtml, '/supplier-workbench.js', 'M7 supplier workbench script');
assertIncludes(supplierWorkbenchHtml, 'id="supplier-summary"', 'M7 supplier summary');
assertIncludes(supplierWorkbenchHtml, 'id="supplier-orders"', 'M7 supplier order list');
assertIncludes(supplierWorkbenchHtml, 'id="supplier-discrepancies"', 'M7 supplier discrepancy list');
assertIncludes(supplierWorkbenchHtml, 'id="supplier-order-detail"', 'M7 supplier order detail');
assertIncludes(supplierWorkbenchHtml, 'id="discrepancy-result"', 'M7 supplier discrepancy result');
assertIncludes(supplierWorkbenchHtml, 'id="supplier-statements"', 'M7 supplier statements');
assertIncludes(supplierWorkbenchHtml, 'id="supplier-payments"', 'M7 supplier payments');
assertIncludes(supplierWorkbenchHtml, 'id="payment-result"', 'M7 supplier payment result');
assertIncludes(supplierWorkbenchHtml, '/purchaser-workbench.html', 'M7 supplier purchaser navigation');
assertIncludes(supplierWorkbenchHtml, '/m7-business-flow.html', 'M7 supplier business flow navigation');
assertIncludes(supplierWorkbenchJs, 'main-flow-demo-seed.json', 'M7 supplier seed loader');
assertIncludes(supplierWorkbenchJs, '/auth/login', 'M7 supplier login');
assertIncludes(supplierWorkbenchJs, '/supplier-orders', 'M7 supplier order endpoint');
assertIncludes(supplierWorkbenchJs, '/notifications', 'M7 supplier notifications endpoint');
assertIncludes(supplierWorkbenchJs, '/supplier-statements', 'M7 supplier statement endpoint');
assertIncludes(supplierWorkbenchJs, '/payment-records?direction=COMPANY_TO_SUPPLIER', 'M7 supplier payment list endpoint');
assertIncludes(supplierWorkbenchJs, '/supplier-orders/${supplierOrderId}', 'M7 supplier order detail endpoint');
assertIncludes(supplierWorkbenchJs, '/supplier-orders/${state.order.id}/shipment-preview', 'M7 supplier shipment preview endpoint');
assertIncludes(supplierWorkbenchJs, '/supplier-orders/${state.order.id}/shipments', 'M7 supplier shipment endpoint');
assertIncludes(supplierWorkbenchJs, '/supplier-orders/${state.order.id}/reject', 'M7 supplier rejection endpoint');
assertIncludes(supplierWorkbenchJs, '/discrepancies/${discrepancyId}', 'M7 supplier discrepancy detail endpoint');
assertIncludes(supplierWorkbenchJs, '/discrepancies/${discrepancyId}/resolve', 'M7 supplier discrepancy resolve endpoint');
assertIncludes(supplierWorkbenchJs, '/payment-records/${paymentId}/${action}', 'M7 supplier payment action endpoint');
assertIncludes(supplierWorkbenchJs, "resolveDiscrepancy('ACCEPT')", 'M7 supplier accept discrepancy action');
assertIncludes(supplierWorkbenchJs, "resolveDiscrepancy('REPLENISH')", 'M7 supplier replenish discrepancy action');
assertIncludes(supplierWorkbenchJs, "resolveDiscrepancy('RETURN')", 'M7 supplier return discrepancy action');
assertIncludes(supplierWorkbenchJs, 'supplier-workbench-ship-', 'M7 supplier idempotent shipment key');
assertIncludes(supplierWorkbenchJs, 'supplier-workbench-reject-', 'M7 supplier idempotent rejection key');
assertIncludes(supplierWorkbenchJs, 'supplier-workbench-discrepancy-', 'M7 supplier idempotent discrepancy key');
assertIncludes(supplierWorkbenchJs, 'supplier-workbench-payment-', 'M7 supplier idempotent payment key');

assertIncludes(businessFlowHtml, '采购协同业务流程', 'M7 business flow page');
assertIncludes(businessFlowHtml, '/m7-business-flow.js', 'M7 business flow script');
assertIncludes(businessFlowHtml, 'id="business-board"', 'M7 business flow board');
assertIncludes(businessFlowHtml, 'id="todo-list"', 'M7 business todo list');
assertIncludes(businessFlowHtml, 'id="timeline"', 'M7 business timeline');
assertIncludes(businessFlowHtml, 'id="finance-panel"', 'M7 business finance panel');
assertIncludes(businessFlowJs, 'main-flow-demo-seed.json', 'M7 business seed loader');
assertIncludes(businessFlowJs, 'main-flow-demo-run.json', 'M7 business evidence loader');
assertIncludes(businessFlowJs, '门店下单', 'M7 store stage');
assertIncludes(businessFlowJs, '采购确认', 'M7 purchaser stage');
assertIncludes(businessFlowJs, '供应商履约', 'M7 supplier stage');
assertIncludes(businessFlowJs, '财务结算', 'M7 finance stage');
assertIncludes(businessFlowJs, '/store-workbench.html', 'M7 store workbench navigation');
assertIncludes(businessFlowJs, '/purchaser-workbench.html', 'M7 purchaser workbench navigation');
assertIncludes(businessFlowJs, '/supplier-workbench.html', 'M7 supplier workbench navigation');
assertIncludes(businessFlowJs, '/billing.html', 'M7 billing navigation');

assertIncludes(opsHtml, '运营与对账', 'W13 ops page');
assertIncludes(opsHtml, '/ops.js', 'W13 ops script');
assertIncludes(opsHtml, '/m6-readiness.html', 'M6 readiness navigation entry');
assertIncludes(opsHtml, 'id="issues"', 'R05 issue table');
assertIncludes(opsHtml, 'id="export-issues"', 'R05 issue CSV export action');
assertIncludes(opsHtml, 'id="export-health-summary"', 'DEV-505 export health summary');
assertIncludes(opsHtml, 'id="export-health-csv"', 'DEV-505 export health CSV action');
assertIncludes(opsHtml, 'id="notifications"', 'I08 notifications table');
assertIncludes(opsHtml, 'id="read-all-notifications"', 'I08 notification bulk read action');
assertIncludes(opsHtml, 'id="audit-logs"', 'DEV-504 audit log table');
assertIncludes(opsHtml, 'id="audit-filter-form"', 'DEV-504 audit filters');
assertIncludes(opsHtml, 'id="export-audit-logs"', 'DEV-504 audit CSV export action');
assertIncludes(opsJs, '/reconciliation-issues', 'R05 reconciliation endpoint');
assertIncludes(opsJs, 'procurex-reconciliation-issues-', 'R05 issue CSV export filename');
assertIncludes(opsJs, '/exports/health', 'DEV-505 export health endpoint');
assertIncludes(opsJs, 'procurex-export-health-', 'DEV-505 export health CSV filename');
assertIncludes(opsJs, '/notifications', 'I08 notifications endpoint');
assertIncludes(opsJs, '/notifications/read-all', 'I08 notification bulk read endpoint');
assertIncludes(opsJs, '/audit-logs', 'DEV-504 audit endpoint');
assertIncludes(opsJs, 'URLSearchParams', 'DEV-504 audit filter query');
assertIncludes(opsJs, 'procurex-audit-logs-', 'DEV-504 audit CSV export filename');
assertIncludes(opsJs, 'data-notification-read', 'I08 notification read action');
assertIncludes(opsJs, '超时处理中', 'DEV-505 stale export health label');
assertIncludes(opsJs, 'STORE_BALANCE_LEDGER_MISMATCH', 'R05 issue labels');

assertIncludes(m6Html, 'M6 上线准备', 'M6 readiness page');
assertIncludes(m6Html, '/m6-readiness.js', 'M6 readiness script');
assertIncludes(m6Html, 'id="readiness-status"', 'M6 readiness status label');
assertIncludes(m6Html, 'id="checks"', 'M6 readiness check list');
assertIncludes(m6Html, 'id="external-checks"', 'M6 external evidence check list');
assertIncludes(m6Html, 'id="package-checks"', 'M6 local evidence package list');
assertIncludes(m6Html, 'id="handoff-links"', 'M6 review handoff list');
assertIncludes(m6Html, 'docs/m6-local-evidence-handoff.md', 'M6 local handoff visible path');
assertIncludes(m6Html, 'docs/m6-wechat-device-evidence-guide.md', 'M6 WeChat device guide visible path');
assertIncludes(m6Html, 'm6:prepare-wechat-evidence', 'M6 WeChat evidence prepare command');
assertIncludes(m6Html, 'm6:check-wechat-evidence', 'M6 WeChat evidence check command');
assertIncludes(m6Html, 'docs/m6-production-runtime-guide.md', 'M6 production runtime guide visible path');
assertIncludes(m6Html, 'm6:check-production-runtime', 'M6 production runtime check command');
assertIncludes(m6Html, 'docs/m6-storage-policy-guide.md', 'M6 storage policy guide visible path');
assertIncludes(m6Html, 'm6:check-storage-policy', 'M6 storage policy check command');
assertIncludes(m6Html, 'docs/m6-customer-evidence-request.md', 'M6 customer evidence request visible path');
assertIncludes(m6Html, 'm6:external-evidence:strict', 'M6 strict external evidence visible command');
assertIncludes(m6Js, 'm6-readiness.json', 'M6 readiness output loader');
assertIncludes(m6Js, 'm6-external-evidence.json', 'M6 external evidence output loader');
assertIncludes(m6Js, 'm6-local-evidence-package.json', 'M6 local evidence package output loader');
assertIncludes(m6Js, 'LOCAL_READY', 'M6 local-ready status rendering');
assertIncludes(m6Js, 'BLOCKED', 'M6 blocked status rendering');
assertIncludes(m6Js, 'docs/m6-evidence-templates/', 'M6 external evidence template fallback');
assertIncludes(m6ReadinessScript, 'WECHAT_APP_ID', 'M6 WeChat external dependency check');
assertIncludes(m6ReadinessScript, 'validateWechatDeviceEvidence', 'M6 WeChat manifest validation guard');
assertIncludes(m6ReadinessScript, 'example.com', 'M6 production endpoint example-domain guard');
assertIncludes(m6ReadinessScript, 'm6-production-runtime.json', 'M6 production runtime report guard');
assertIncludes(m6ReadinessScript, 'm6-storage-policy-guide.md', 'M6 storage policy guide guard');
assertIncludes(m6ReadinessScript, 'mini-flow-check.json', 'M6 mini-program flow evidence check');
assertIncludes(m6ReadinessScript, 'check-miniprogram-flow.mjs', 'M6 mini-program flow script evidence');
assertIncludes(m6ReadinessScript, 'm6-performance-report.json', 'M6 performance evidence check');
assertIncludes(m6ReadinessScript, 'check-m6-performance.mjs', 'M6 performance script evidence');
assertIncludes(m6ReadinessScript, 'm6-rollback-drill.json', 'M6 rollback evidence check');
assertIncludes(m6ReadinessScript, 'check-m6-rollback.mjs', 'M6 rollback script evidence');
assertIncludes(m6ReadinessScript, 'm6-initialization-signoff.json', 'M6 initialization evidence check');
assertIncludes(m6ReadinessScript, 'check-m6-initialization.mjs', 'M6 initialization script evidence');
assertIncludes(m6ReadinessScript, 'productionFinalSignoff', 'M6 initialization final signoff guard');
assertIncludes(m6ReadinessScript, 'm6-pilot-run.json', 'M6 pilot evidence check');
assertIncludes(m6ReadinessScript, 'check-m6-pilot.mjs', 'M6 pilot script evidence');
assertIncludes(m6ReadinessScript, 'customerPilot', 'M6 pilot final signoff guard');
assertIncludes(m6ReadinessScript, 'RPO<=15 minutes', 'M6 recovery target check');
assertIncludes(m6ReadinessScript, 'm6-readiness.json', 'M6 readiness output writer');
assertIncludes(m6ReadinessScript, 'var/m6-readiness-evidence/manifest.json', 'M6 readiness browser evidence manifest');

console.log('Web workbench check passed.');
