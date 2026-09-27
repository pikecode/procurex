import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import {
  FundingAllocationMethod,
  LedgerDirection,
  LedgerSourceType,
  StoreStatus,
} from '../../packages/backend/generated/prisma/enums.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../packages/domain/src/password.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';

function createClient(): InstanceType<typeof PrismaClient> {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

async function createTestApp(): Promise<{ app: INestApplication; baseUrl: string }> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${address.port}/api/v1` };
}

async function login(baseUrl: string, username: string): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'correct-password', client: 'web' }),
  });
  assert.equal(response.status, 201);

  const body = (await response.json()) as { data: { accessToken: string } };
  return body.data.accessToken;
}

test('stores endpoint creates, lists and disables stores with admin role', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const adminUsername = `it_stores_admin_${runId}`;
  const storeUsername = `it_stores_store_${runId}`;
  const storeCode = `S${runId}`;
  const { app, baseUrl } = await createTestApp();

  try {
    const [adminRole, storeRole] = await Promise.all([
      prisma.role.upsert({ where: { code: 'ADMIN' }, update: {}, create: { code: 'ADMIN', name: 'Administrator' } }),
      prisma.role.upsert({ where: { code: 'STORE' }, update: {}, create: { code: 'STORE', name: 'Store' } }),
    ]);

    await Promise.all([
      prisma.user.create({
        data: {
          username: adminUsername,
          displayName: 'Integration Stores Admin',
          passwordHash: await hashPassword('correct-password'),
          roles: { create: [{ roleId: adminRole.id }] },
        },
      }),
      prisma.user.create({
        data: {
          username: storeUsername,
          displayName: 'Integration Stores Store',
          passwordHash: await hashPassword('correct-password'),
          roles: { create: [{ roleId: storeRole.id }] },
        },
      }),
    ]);

    const [adminToken, storeToken] = await Promise.all([login(baseUrl, adminUsername), login(baseUrl, storeUsername)]);

    const forbidden = await fetch(`${baseUrl}/stores`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${storeToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-stores-forbidden',
      },
      body: JSON.stringify({ code: storeCode, name: 'Forbidden Store' }),
    });
    assert.equal(forbidden.status, 403);

    const created = await fetch(`${baseUrl}/stores`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-stores-create',
      },
      body: JSON.stringify({
        code: storeCode,
        name: 'Main Test Store',
        contactName: 'Alice',
        contactPhone: '13800000000',
        address: 'Shanghai',
      }),
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as {
      data: { id: string; code: string; name: string; status: StoreStatus; version: number };
      traceId: string;
    };
    assert.equal(createdBody.traceId, 'trace-stores-create');
    assert.equal(createdBody.data.code, storeCode);
    assert.equal(createdBody.data.status, StoreStatus.ACTIVE);
    const createRecharge = async () => {
      const response = await fetch(`${baseUrl}/stores/${createdBody.data.id}/recharges`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
          'idempotency-key': 'create-store-recharge-once',
          'x-trace-id': 'trace-store-recharge',
        },
        body: JSON.stringify({
          amount: '320.50',
          businessDate: '2026-09-24',
          collectionAccountId: 'COLLECT-001',
          remark: 'Initial recharge',
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: {
          id: string;
          rechargeNo: string;
          storeId: string;
          amount: string;
          businessDate: string;
          collectionAccountId: string;
          remark: string | null;
          account: { id: string; balance: string; creditLimit: string; creditUsed: string; creditAvailable: string; version: number };
        };
        traceId: string;
      };
    };
    const recharge = await createRecharge();
    const rechargeReplay = await createRecharge();
    assert.deepEqual(rechargeReplay.data, recharge.data);
    assert.equal(recharge.traceId, 'trace-store-recharge');
    assert.equal(recharge.data.storeId, createdBody.data.id);
    assert.equal(recharge.data.amount, '320.50');
    assert.equal(recharge.data.businessDate, '2026-09-24');
    assert.equal(recharge.data.collectionAccountId, 'COLLECT-001');
    assert.equal(recharge.data.remark, 'Initial recharge');
    assert.equal(recharge.data.account.balance, '320.50');

    const rechargeDetailResponse = await fetch(`${baseUrl}/recharges/${recharge.data.id}`, {
      headers: {
        authorization: `Bearer ${storeToken}`,
        'x-trace-id': 'trace-recharge-detail',
      },
    });
    assert.equal(rechargeDetailResponse.status, 200);
    const rechargeDetail = (await rechargeDetailResponse.json()) as {
      data: {
        id: string;
        rechargeNo: string;
        storeId: string;
        amount: string;
        businessDate: string;
        collectionAccountId: string;
        remark: string | null;
        account: { id: string; balance: string };
      };
      traceId: string;
    };
    assert.equal(rechargeDetail.traceId, 'trace-recharge-detail');
    assert.equal(rechargeDetail.data.id, recharge.data.id);
    assert.equal(rechargeDetail.data.rechargeNo, recharge.data.rechargeNo);
    assert.equal(rechargeDetail.data.storeId, createdBody.data.id);
    assert.equal(rechargeDetail.data.amount, '320.50');
    assert.equal(rechargeDetail.data.businessDate, '2026-09-24');
    assert.equal(rechargeDetail.data.collectionAccountId, 'COLLECT-001');
    assert.equal(rechargeDetail.data.remark, 'Initial recharge');
    assert.equal(rechargeDetail.data.account.id, recharge.data.account.id);
    assert.equal(rechargeDetail.data.account.balance, '320.50');

    const accountResponse = await fetch(`${baseUrl}/stores/${createdBody.data.id}/account`, {
      headers: {
        authorization: `Bearer ${storeToken}`,
        'x-trace-id': 'trace-store-account',
      },
    });
    assert.equal(accountResponse.status, 200);
    const accountBody = (await accountResponse.json()) as {
      data: {
        id: string;
        storeId: string;
        balance: string;
        creditLimit: string;
        creditUsed: string;
        creditAvailable: string;
        version: number;
      };
      traceId: string;
    };
    assert.equal(accountBody.traceId, 'trace-store-account');
    assert.equal(accountBody.data.id, recharge.data.account.id);
    assert.equal(accountBody.data.storeId, createdBody.data.id);
    assert.equal(accountBody.data.balance, '320.50');
    assert.equal(accountBody.data.creditLimit, '0.00');
    assert.equal(accountBody.data.creditUsed, '0.00');
    assert.equal(accountBody.data.creditAvailable, '0.00');
    assert.equal(accountBody.data.version, 1);

    const updateCreditLimit = async () => {
      const response = await fetch(`${baseUrl}/stores/${createdBody.data.id}/credit-limit`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
          'idempotency-key': 'update-store-credit-limit-once',
          'x-trace-id': 'trace-store-credit-limit',
        },
        body: JSON.stringify({
          expectedVersion: accountBody.data.version,
          limit: '1000.00',
          reason: 'Opening credit limit',
        }),
      });
      assert.equal(response.status, 200);
      return (await response.json()) as {
        data: { id: string; balance: string; creditLimit: string; creditUsed: string; creditAvailable: string; version: number };
        traceId: string;
      };
    };
    const creditLimit = await updateCreditLimit();
    const creditLimitReplay = await updateCreditLimit();
    assert.deepEqual(creditLimitReplay.data, creditLimit.data);
    assert.equal(creditLimit.traceId, 'trace-store-credit-limit');
    assert.equal(creditLimit.data.id, recharge.data.account.id);
    assert.equal(creditLimit.data.balance, '320.50');
    assert.equal(creditLimit.data.creditLimit, '1000.00');
    assert.equal(creditLimit.data.creditUsed, '0.00');
    assert.equal(creditLimit.data.creditAvailable, '1000.00');
    assert.equal(creditLimit.data.version, 2);
    await prisma.storeAccount.update({
      where: { storeId: createdBody.data.id },
      data: { creditUsed: '200.00', version: { increment: 1 } },
    });
    const lowerBelowUsedResponse = await fetch(`${baseUrl}/stores/${createdBody.data.id}/credit-limit`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json', 'idempotency-key': 'lower-credit-limit-below-used', 'x-trace-id': 'trace-credit-limit-below-used' },
      body: JSON.stringify({ expectedVersion: 3, limit: '199.99', reason: 'AT-17 regression' }),
    });
    assert.equal(lowerBelowUsedResponse.status, 409);
    assert.match(JSON.stringify(await lowerBelowUsedResponse.json()), /CREDIT_LIMIT_BELOW_USED/);
    const unchangedAccount = await prisma.storeAccount.findUniqueOrThrow({ where: { storeId: createdBody.data.id } });
    assert.equal(unchangedAccount.creditLimit.toFixed(2), '1000.00');
    assert.equal(unchangedAccount.creditUsed.toFixed(2), '200.00');
    const fundingAllocation = await prisma.fundingAllocation.create({
      data: {
        storeId: createdBody.data.id,
        method: FundingAllocationMethod.CREDIT,
        targetAmount: '240.00',
        netPaid: '40.00',
        creditOutstanding: '200.00',
      },
    });
    const clearingPreviewResponse = await fetch(`${baseUrl}/stores/${createdBody.data.id}/clearings/preview`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-clearing-preview',
      },
      body: JSON.stringify({ fundingAllocationIds: [fundingAllocation.id] }),
    });
    assert.equal(clearingPreviewResponse.status, 201);
    const clearingPreview = (await clearingPreviewResponse.json()) as {
      data: {
        storeId: string;
        totalAmount: string;
        items: Array<{
          fundingAllocationId: string;
          method: FundingAllocationMethod;
          targetAmount: string;
          netPaid: string;
          creditOutstanding: string;
          clearableAmount: string;
          version: number;
        }>;
      };
      traceId: string;
    };
    assert.equal(clearingPreview.traceId, 'trace-clearing-preview');
    assert.equal(clearingPreview.data.storeId, createdBody.data.id);
    assert.equal(clearingPreview.data.totalAmount, '200.00');
    assert.deepEqual(clearingPreview.data.items, [
      {
        fundingAllocationId: fundingAllocation.id,
        method: FundingAllocationMethod.CREDIT,
        targetAmount: '240.00',
        netPaid: '40.00',
        creditOutstanding: '200.00',
        clearableAmount: '200.00',
        version: 1,
      },
    ]);

    const ledgersResponse = await fetch(
      `${baseUrl}/stores/${createdBody.data.id}/ledgers?occurredFrom=2026-09-24T00:00:00.000Z&occurredTo=2026-09-25T00:00:00.000Z`,
      {
        headers: {
          authorization: `Bearer ${adminToken}`,
          'x-trace-id': 'trace-store-ledgers',
        },
      },
    );
    assert.equal(ledgersResponse.status, 200);
    const ledgersBody = (await ledgersResponse.json()) as {
      data: Array<{
        accountId: string;
        direction: LedgerDirection;
        amount: string;
        balanceAfter: string;
        sourceType: LedgerSourceType;
        sourceId: string;
        note: string | null;
        occurredAt: string;
      }>;
      traceId: string;
    };
    assert.equal(ledgersBody.traceId, 'trace-store-ledgers');
    assert.equal(ledgersBody.data.length, 1);
    assert.equal(ledgersBody.data[0]?.accountId, recharge.data.account.id);
    assert.equal(ledgersBody.data[0]?.direction, LedgerDirection.CREDIT);
    assert.equal(ledgersBody.data[0]?.amount, '320.50');
    assert.equal(ledgersBody.data[0]?.balanceAfter, '320.50');
    assert.equal(ledgersBody.data[0]?.sourceType, LedgerSourceType.RECHARGE);
    assert.equal(ledgersBody.data[0]?.sourceId, recharge.data.id);
    assert.equal(ledgersBody.data[0]?.note, 'Initial recharge');
    assert.equal(ledgersBody.data[0]?.occurredAt, '2026-09-24T00:00:00.000Z');

    const createClearing = async () => {
      const response = await fetch(`${baseUrl}/stores/${createdBody.data.id}/clearings`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
          'idempotency-key': 'create-store-clearing-once',
          'x-trace-id': 'trace-store-clearing',
        },
        body: JSON.stringify({
          businessDate: '2026-09-24',
          remark: 'Clear store credit',
          items: [
            {
              fundingAllocationId: fundingAllocation.id,
              expectedVersion: clearingPreview.data.items[0]!.version,
              expectedAmount: clearingPreview.data.items[0]!.clearableAmount,
            },
          ],
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: {
          id: string;
          clearingNo: string;
          storeId: string;
          amount: string;
          businessDate: string;
          remark: string | null;
          items: Array<{ fundingAllocationId: string; amount: string; sourceVersion: number }>;
          account: { creditUsed: string; creditAvailable: string; version: number };
        };
        traceId: string;
      };
    };
    const clearing = await createClearing();
    const clearingReplay = await createClearing();
    assert.deepEqual(clearingReplay.data, clearing.data);
    assert.equal(clearing.traceId, 'trace-store-clearing');
    assert.equal(clearing.data.storeId, createdBody.data.id);
    assert.equal(clearing.data.amount, '200.00');
    assert.equal(clearing.data.businessDate, '2026-09-24');
    assert.equal(clearing.data.remark, 'Clear store credit');
    assert.deepEqual(clearing.data.items.map((item) => ({
      fundingAllocationId: item.fundingAllocationId,
      amount: item.amount,
      sourceVersion: item.sourceVersion,
    })), [
      {
        fundingAllocationId: fundingAllocation.id,
        amount: '200.00',
        sourceVersion: 1,
      },
    ]);
    assert.equal(clearing.data.account.creditUsed, '0.00');
    assert.equal(clearing.data.account.creditAvailable, '1000.00');
    const clearedAllocation = await prisma.fundingAllocation.findUniqueOrThrow({ where: { id: fundingAllocation.id } });
    assert.equal(clearedAllocation.active, false);
    assert.equal(clearedAllocation.netPaid.toString(), '240');
    assert.equal(clearedAllocation.creditOutstanding.toString(), '0');
    assert.equal(clearedAllocation.version, 2);
    const clearingDetailResponse = await fetch(`${baseUrl}/clearings/${clearing.data.id}`, {
      headers: {
        authorization: `Bearer ${storeToken}`,
        'x-trace-id': 'trace-clearing-detail',
      },
    });
    assert.equal(clearingDetailResponse.status, 200);
    const clearingDetail = (await clearingDetailResponse.json()) as {
      data: {
        id: string;
        clearingNo: string;
        storeId: string;
        amount: string;
        businessDate: string;
        remark: string | null;
        items: Array<{ fundingAllocationId: string; amount: string; sourceVersion: number }>;
        account: { creditUsed: string; creditAvailable: string };
      };
      traceId: string;
    };
    assert.equal(clearingDetail.traceId, 'trace-clearing-detail');
    assert.equal(clearingDetail.data.id, clearing.data.id);
    assert.equal(clearingDetail.data.clearingNo, clearing.data.clearingNo);
    assert.equal(clearingDetail.data.storeId, createdBody.data.id);
    assert.equal(clearingDetail.data.amount, '200.00');
    assert.equal(clearingDetail.data.businessDate, '2026-09-24');
    assert.equal(clearingDetail.data.remark, 'Clear store credit');
    assert.deepEqual(clearingDetail.data.items.map((item) => ({
      fundingAllocationId: item.fundingAllocationId,
      amount: item.amount,
      sourceVersion: item.sourceVersion,
    })), [
      {
        fundingAllocationId: fundingAllocation.id,
        amount: '200.00',
        sourceVersion: 1,
      },
    ]);
    assert.equal(clearingDetail.data.account.creditUsed, '0.00');
    assert.equal(clearingDetail.data.account.creditAvailable, '1000.00');

    const list = await fetch(`${baseUrl}/stores`, {
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-trace-id': 'trace-stores-list',
      },
    });
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as { data: Array<{ id: string; code: string; version: number }>; traceId: string };
    assert.equal(listBody.traceId, 'trace-stores-list');
    assert.ok(listBody.data.some((store) => store.code === storeCode));

    const conflict = await fetch(`${baseUrl}/stores/${createdBody.data.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-stores-conflict',
      },
      body: JSON.stringify({ expectedVersion: 1, status: StoreStatus.DISABLED }),
    });
    assert.equal(conflict.status, 409);

    const disabled = await fetch(`${baseUrl}/stores/${createdBody.data.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-stores-disable',
      },
      body: JSON.stringify({ expectedVersion: createdBody.data.version, status: StoreStatus.DISABLED }),
    });
    assert.equal(disabled.status, 200);
    const disabledBody = (await disabled.json()) as { data: { status: StoreStatus }; traceId: string };
    assert.equal(disabledBody.traceId, 'trace-stores-disable');
    assert.equal(disabledBody.data.status, StoreStatus.DISABLED);
  } finally {
    await app.close();
    await prisma.commandRecord.deleteMany({ where: { actor: { username: adminUsername } } });
    await prisma.accountLedger.deleteMany({ where: { account: { store: { code: storeCode } } } });
    await prisma.clearingItem.deleteMany({ where: { clearing: { store: { code: storeCode } } } });
    await prisma.clearingDocument.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.rechargeDocument.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.fundingAllocation.deleteMany({ where: { store: { store: { code: storeCode } } } });
    await prisma.storeAccount.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.store.deleteMany({ where: { code: storeCode } });
    await prisma.userSession.deleteMany({ where: { user: { username: { in: [adminUsername, storeUsername] } } } });
    await prisma.userRole.deleteMany({ where: { user: { username: { in: [adminUsername, storeUsername] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [adminUsername, storeUsername] } } });
    await prisma.$disconnect();
  }
});
