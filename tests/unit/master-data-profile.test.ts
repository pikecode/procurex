import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStoreProfile, parseSupplierProfile, profileText, storeDestination } from '../../apps/api/src/common/master-data-profile.js';
import type { ValidationIssue } from '../../packages/domain/src/validation.js';

test('store receipt profile is an atomic triple, with explicit reset to store contact details', () => {
  let issues: ValidationIssue[] = [];
  parseStoreProfile({ storeType: 'OTHER' }, true, issues);
  assert.equal(issues.length, 1);
  issues = [];
  parseStoreProfile({ receiptAddress: 'Warehouse' }, false, issues);
  assert.ok(issues.some(issue => issue.code === 'INCOMPLETE_RECEIPT_PROFILE'));
  issues = [];
  const profile = parseStoreProfile({ storeType: 'JOINT', groupName: null, receiptAddress: null, receiptContactName: null, receiptContactPhone: null }, true, issues);
  assert.deepEqual(issues, []); assert.equal(profile.receiptAddress, null);
  const store = { name: 'Store', address: 'Main address', contactName: 'Main contact', contactPhone: '123', receiptAddress: null, receiptContactName: null, receiptContactPhone: null };
  assert.deepEqual(storeDestination(store), { name: 'Store', address: 'Main address', contactName: 'Main contact', contactPhone: '123' });
  assert.equal(storeDestination({ ...store, receiptAddress: 'Warehouse', receiptContactName: 'Receiver', receiptContactPhone: '456' }).contactName, 'Receiver');
});

test('supplier banking/tax/address fields are optional and freight defaults off while patches stay partial', () => {
  let issues: ValidationIssue[] = [];
  assert.equal(parseSupplierProfile({}, true, issues).requiresFreight, false); assert.deepEqual(issues, []);
  issues = [];
  const profile = parseSupplierProfile({ address: 'Address', bankName: 'Bank', bankAccountName: 'Name', bankAccount: '00123', taxpayerId: 'Tax', invoiceTitle: 'Title' }, true, issues);
  assert.deepEqual(issues, []); assert.equal(profile.requiresFreight, false); assert.equal(profile.bankAccount, '00123');
  issues = [];
  assert.equal(parseSupplierProfile({}, false, issues).requiresFreight, undefined); assert.deepEqual(issues, []);
  parseSupplierProfile({ requiresFreight: 'false', bankAccount: null, defaultSettlementCycle: 'CUSTOM', supplierType: 'OTHER' }, false, issues);
  assert.equal(issues.length, 3);
});

test('optional supplier fields can be cleared but reject invalid types and excessive lengths', () => {
  const issues: ValidationIssue[] = [];
  const result = parseSupplierProfile({ address: '  ', bankName: '', bankAccountName: null, bankAccount: null, taxpayerId: '', invoiceTitle: null }, false, issues);
  assert.deepEqual(issues, []);
  for (const key of ['address', 'bankName', 'bankAccountName', 'bankAccount', 'taxpayerId', 'invoiceTitle'] as const) assert.equal(result[key], null);
  parseSupplierProfile({ bankAccount: 123, bankName: 'x'.repeat(201) }, true, issues);
  assert.equal(issues.length, 2);
});

test('profile fields validate lengths, reject clearing required values, and retain explicit optional clearing', () => {
  const issues: ValidationIssue[] = [];
  assert.equal(profileText('bankAccount', ' 00123 ', 80, true, false, issues), '00123');
  assert.equal(profileText('remark', null, 500, false, true, issues), null);
  assert.equal(profileText('address', undefined, 300, false, false, issues), undefined);
  profileText('address', null, 300, false, false, issues);
  profileText('contactPhone', '1'.repeat(33), 32, true, false, issues);
  assert.equal(issues.length, 2);
});
