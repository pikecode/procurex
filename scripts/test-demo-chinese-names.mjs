import assert from 'node:assert/strict';
import test from 'node:test';
import { localizedFixtureName } from './demo-chinese-names.mjs';

test('only recognizable fixtures with original names are localized', () => {
  assert.equal(localizedFixtureName('Store', 'PXFLOW-STORE', 'PX Flow Demo Store'), '主流程演示门店');
  assert.equal(localizedFixtureName('Store', 'REAL-STORE', 'PX Flow Demo Store'), 'PX Flow Demo Store');
  assert.equal(localizedFixtureName('Store', 'PXFLOW-STORE', '用户修改的门店'), '用户修改的门店');
  assert.equal(localizedFixtureName('Unit', 'PXFLOW-UNIT', 'piece'), '件');
  assert.equal(localizedFixtureName('Unit', 'BUSINESS-UNIT', 'piece'), 'piece');
  assert.equal(localizedFixtureName('User', 'it_confirm_finance_123', 'Integration Confirm Finance'), '确认流程财务用户');
  assert.equal(localizedFixtureName('User', 'it_direct_store_123', 'it_direct_store_123'), '门店测试用户');
  assert.equal(localizedFixtureName('User', 'it_direct_store_123', '真实姓名'), '真实姓名');
  assert.equal(localizedFixtureName('Product', 'PXFLOW-NATIVE-2', '小程序验收商品2'), '小程序验收商品2');
});
