import { useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, Modal, Select, Tag, Tooltip } from 'antd';
import { Eye } from 'lucide-react';
import { ListPage } from '../components/ListPage';
import { hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { adminCommandPath, useWorkflowCommand } from '../lib/useWorkflowCommand';
import { workflowTime } from '../lib/workflowTypes';

interface Command { id: string; action: string; status: string; actorUserId: string; resourceType: string | null; resourceId: string | null; traceId: string; startedAt: string; errorCode: string | null }
const statuses: Record<string, string> = { PROCESSING: '处理中', SUCCEEDED: '已完成', FAILED: '失败' };
const operations: Record<string, string> = { reviews: '记录人工复核', 'close-rolled-back-price': '关闭已回滚价格命令', 'close-uncommitted-price': '关闭未提交价格命令' };
export default function Commands({ user }: { user: User }) {
  const [scope, setScope] = useState('stale'); const path = scope === 'stale' ? '/commands/stale?limit=100' : '/commands?limit=100';
  const data = useRows<Command>(path); const [detail, setDetail] = useState<Command | null>(null);
  const [operation, setOperation] = useState(''); const [error, setError] = useState(''); const [checking, setChecking] = useState(false);
  const [form] = Form.useForm(); const command = useWorkflowCommand(user.id);
  const reload = () => { data.reload(); setDetail(null); setOperation(''); };
  const price = detail?.status === 'PROCESSING' && detail.action === 'price.process' && detail.resourceType === 'PriceChangeRun' && Boolean(detail.resourceId);
  const choose = (value: string) => { form.resetFields(); setOperation(value); };
  return <section>
    {command.error && <Alert type="error" showIcon title={command.error} />}
    {command.pending && <Alert type="warning" showIcon title={command.pending.label} action={<Button disabled={!hasRole(user, 'ADMIN') || !adminCommandPath(command.pending.path)} loading={command.busy} onClick={async () => { if (await command.recover()) reload(); }}>恢复原提交</Button>} />}
    <ListPage title="命令诊断" rows={data.rows.map(row => ({ ...row, name: row.action }))} loading={data.loading} error={data.error} reload={reload}
      tools={<Select aria-label="命令范围" value={scope} options={[{ value: 'stale', label: '超时待核对' }, { value: 'own', label: '我的最近提交' }]} onChange={value => { setScope(value); setDetail(null); }} />}
      columns={[
        { title: '操作', dataIndex: 'action', width: 200 }, { title: '状态', dataIndex: 'status', width: 100, render: value => <Tag>{statuses[value] || value}</Tag> },
        { title: '提交时间', dataIndex: 'startedAt', width: 180, render: workflowTime }, { title: '资源类型', dataIndex: 'resourceType', width: 160 },
        { title: '错误代码', dataIndex: 'errorCode', width: 220 }, { title: '操作', width: 70, render: (_, row) => <Tooltip title="查看命令"><Button aria-label="查看命令" icon={<Eye size={16} />} onClick={() => { setDetail(row); setOperation(''); setError(''); }} /></Tooltip> },
      ]} />
    <Modal title="命令详情" open={Boolean(detail)} onCancel={() => { if (!checking && !command.busy) setDetail(null); }} footer={null} width={680}>
      {detail && <>
        <Descriptions size="small" column={1} items={[
          { key: 'id', label: '命令ID', children: detail.id }, { key: 'action', label: '操作', children: detail.action },
          { key: 'status', label: '状态', children: statuses[detail.status] || detail.status }, { key: 'trace', label: '追踪ID', children: detail.traceId },
          { key: 'resource', label: '资源ID', children: detail.resourceId || '-' }, { key: 'actor', label: '提交人ID', children: detail.actorUserId },
          { key: 'time', label: '提交时间', children: workflowTime(detail.startedAt) }, { key: 'error', label: '错误代码', children: detail.errorCode || '-' },
        ]} />
        {error && <Alert type="error" showIcon title={error} />}
        {!operation ? <div className="actions">
          <Button disabled={command.blocked || detail.action === 'command.review'} onClick={() => choose('reviews')}>记录人工复核</Button>
          {price && <><Button danger disabled={command.blocked || detail.errorCode !== 'COMMAND_ROLLBACK_CONFIRMED'} onClick={() => choose('close-rolled-back-price')}>关闭已回滚价格命令</Button>
            <Button danger disabled={command.blocked} onClick={() => choose('close-uncommitted-price')}>关闭未提交价格命令</Button></>}
        </div> : <Form form={form} layout="vertical" disabled={command.blocked || checking} onFinish={async values => {
          if (checking || command.blocked) return; setChecking(true); setError('');
          try {
            const current = (await request<Command[]>(path)).find(row => row.id === detail.id);
            if (!current || current.status !== detail.status || current.action !== detail.action || current.errorCode !== detail.errorCode || current.resourceId !== detail.resourceId) { data.reload(); setOperation(''); throw new Error('命令状态已变化或不在当前列表，请刷新后重新核对。'); }
            if (await command.submit({ path: `/commands/${detail.id}/${operation}`, method: 'POST', body: { reason: values.reason.trim(), ...(operation === 'reviews' ? { expectedStatus: detail.status } : {}) }, label: operations[operation] })) reload();
          } catch (failure) { setError((failure as Error).message); } finally { setChecking(false); }
        }}>
          <Form.Item label="复核原因" name="reason" rules={[{ required: true, whitespace: true, message: '请输入复核原因' }, { max: 500, message: '最多500字' }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item>
          <div className="actions"><Button onClick={() => setOperation('')}>取消</Button><Button type="primary" danger={operation !== 'reviews'} htmlType="submit" loading={checking || command.busy}>{operations[operation]}</Button></div>
        </Form>}
      </>}
    </Modal>
  </section>;
}
