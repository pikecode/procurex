import assert from 'node:assert/strict';
import test from 'node:test';
import { UsersService } from '../../apps/api/src/users/users.service.js';
import { OwnPasswordController, UsersController } from '../../apps/api/src/users/users.controller.js';
import { hashPassword, verifyPassword } from '../../packages/domain/src/password.js';
import { UserStatus } from '../../packages/backend/generated/prisma/enums.js';

const context = { actorUserId: 'actor', activeScope: { roles: ['ADMIN'] }, traceId: 'test' };
function setup(role = 'ADMIN', others = 0) {
  const user = { id: 'target', username: 'target', displayName: 'Target', passwordHash: null as string | null, phone: null, status: UserStatus.ACTIVE, createdAt: new Date(1), updatedAt: new Date(1), roles: [{ role: { code: role } }], scopes: [{ scopeType: 'COMPANY', storeId: null, supplierId: null }] };
  let revoked = 0; const audit: unknown[] = [];
  const tx = { $executeRaw: async () => 1,
    user: { findUnique: async () => user, findUniqueOrThrow: async () => user, count: async () => others,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(user, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))); return { count: 1 }; },
      update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(user, data); return user; } },
    userSession: { updateMany: async () => { revoked++; return { count: 2 }; } },
    userScope: { upsert: async () => {} }, store: { findFirst: async () => null }, supplier: { findFirst: async () => null },
    role: { findUnique: async () => ({ id: 'role' }) }, userRole: { deleteMany: async () => {}, create: async () => {} },
  };
  const client = { ...tx, $transaction: async (work: (value: typeof tx) => unknown) => work(tx) };
  const service = new UsersService({ client } as never, { record: async (value: unknown) => { audit.push(value); } } as never);
  return { service, user, audit, revoked: () => revoked };
}

test('account changes protect self and last active administrator', async () => {
  const last = setup();
  await assert.rejects(last.service.updateUser('target', { expectedVersion: 1, status: UserStatus.DISABLED }, context), /必须保留/);
  await assert.rejects(last.service.updateUser('target', { expectedVersion: 1, role: 'PURCHASER' }, context), /必须保留/);
  const self = { ...context, actorUserId: 'target' };
  await assert.rejects(last.service.updateUser('target', { expectedVersion: 1, status: UserStatus.DISABLED }, self), /不能停用自己/);
  await assert.rejects(last.service.updateUser('target', { expectedVersion: 1, role: 'PURCHASER' }, self), /不能停用自己/);
  assert.equal(last.revoked(), 0);
});

test('disabling an account revokes sessions while display-name edits do not', async () => {
  const disabled = setup('PURCHASER');
  await disabled.service.updateUser('target', { expectedVersion: 1, status: UserStatus.DISABLED }, context);
  assert.equal(disabled.revoked(), 1);
  const name = setup();
  await name.service.updateUser('target', { expectedVersion: 1, displayName: 'Updated' }, context);
  assert.equal(name.revoked(), 0);
  const entry = name.audit[0] as { before: { displayName: string; roles: string[] }; after: { displayName: string; roles: string[] } };
  assert.equal(entry.before.displayName, 'Target');
  assert.equal(entry.after.displayName, 'Updated');
  assert.deepEqual(entry.before.roles, ['ADMIN']);
  assert.deepEqual(entry.after.roles, ['ADMIN']);
});

test('role updates reject mismatched scope and invalid master-data bindings', async () => {
  const target = setup('PURCHASER');
  await assert.rejects(target.service.updateUser('target', { expectedVersion: 1, role: 'STORE' }, context), /角色与所属/);
  await assert.rejects(target.service.updateUser('target', { expectedVersion: 1, role: 'STORE', scope: { type: 'STORE', storeId: 'missing' } }, context), /启用的门店/);
});

test('password changes verify old password, reject unchanged passwords and redact audit data', async () => {
  const target = setup('PURCHASER'); target.user.passwordHash = await hashPassword('OldPassword123!');
  await assert.rejects(target.service.changePassword('target', 'wrong', 'NewPassword123!', context), /当前密码不正确/);
  await assert.rejects(target.service.changePassword('target', 'OldPassword123!', 'OldPassword123!', context), /新密码不能/);
  await target.service.changePassword('target', 'OldPassword123!', 'NewPassword123!', context);
  assert.equal(await verifyPassword('NewPassword123!', target.user.passwordHash), true);
  assert.equal(target.revoked(), 1);
  assert.ok(!JSON.stringify(target.audit).includes('Password123'));
  assert.ok(!JSON.stringify(target.audit).includes(target.user.passwordHash));
});

test('session revocation preserves account status', async () => {
  const target = setup(); await target.service.revokeSessions('target', context);
  assert.equal(target.revoked(), 1); assert.equal(target.user.status, UserStatus.ACTIVE);
});

test('password and role controller validation rejects invalid input before persistence', () => {
  const own = new OwnPasswordController({} as never); const admin = new UsersController({} as never);
  assert.throws(() => own.changePassword({ currentPassword: '', password: 'short' }, {} as never));
  assert.throws(() => admin.resetPassword('invalid', { password: 'short' }, {} as never));
  assert.throws(() => admin.updateUser('3897e8ab-d990-4547-a23e-22f89cc74c8b', { expectedVersion: 1, role: 'UNKNOWN' }, {} as never));
});
