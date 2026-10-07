import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Drawer, List, Modal, Tag, Tooltip } from 'antd';
import { Bell, Check, CheckCheck, RotateCcw } from 'lucide-react';
import { request } from '../lib/api';
import { workflowTime } from '../lib/workflowTypes';

type Notice = { id: string; title: string; body: string; status: string; createdAt: string; readAt: string | null };
type Inbox = { unreadCount: number; notifications: Notice[] };

export function Notifications({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false); const [detail, setDetail] = useState<Notice>();
  const [inbox, setInbox] = useState<Inbox>({ unreadCount: 0, notifications: [] });
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(''); const [revision, setRevision] = useState(0); const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    request<Inbox>('/notifications', { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setInbox(value);
    }).catch(failure => { if (!controller.signal.aborted) setError((failure as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, open, revision]);
  async function read(notice?: Notice) {
    if (lock.current) return; lock.current = true; setSaving(true); setError('');
    try {
      if (notice) {
        const updated = await request<Notice>(`/notifications/${notice.id}/read`, { method: 'POST' });
        setDetail(current => current?.id === updated.id ? updated : current);
      } else await request('/notifications/read-all', { method: 'POST' });
      setRevision(value => value + 1);
    } catch (failure) { setError((failure as Error).message); }
    finally { lock.current = false; setSaving(false); }
  }
  return <>
    <Tooltip title="通知"><Badge count={inbox.unreadCount} size="small"><Button type="text" aria-label="通知" icon={<Bell size={17} />} onClick={() => setOpen(true)} /></Badge></Tooltip>
    <Drawer title="通知" open={open} onClose={() => setOpen(false)} width={480} extra={<div className="actions">
      <Tooltip title="全部已读"><Button aria-label="全部已读" icon={<CheckCheck size={16} />} disabled={loading || saving || !inbox.unreadCount} onClick={() => read()} /></Tooltip>
      <Tooltip title="刷新通知"><Button aria-label="刷新通知" icon={<RotateCcw size={16} />} loading={loading} disabled={saving} onClick={() => setRevision(value => value + 1)} /></Tooltip>
    </div>}>
      {error && <Alert type="error" showIcon title={error} action={<Button onClick={() => setRevision(value => value + 1)}>重试</Button>} />}
      <List loading={loading} dataSource={inbox.notifications} pagination={{ pageSize: 10, size: 'small', hideOnSinglePage: true }} locale={{ emptyText: '暂无通知' }} renderItem={notice => <List.Item actions={notice.status === 'UNREAD' ? [<Tooltip key="read" title="标为已读"><Button aria-label={`标为已读${notice.title}`} icon={<Check size={16} />} disabled={saving} onClick={() => read(notice)} /></Tooltip>] : []}>
        <List.Item.Meta title={<Button type="link" style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => setDetail(notice)}>{notice.title}</Button>}
          description={<><Tag color={notice.status === 'UNREAD' ? 'processing' : 'default'}>{notice.status === 'UNREAD' ? '未读' : '已读'}</Tag>{workflowTime(notice.createdAt)}</>} />
      </List.Item>} />
    </Drawer>
    <Modal title={detail?.title} open={Boolean(detail)} onCancel={() => setDetail(undefined)} footer={detail?.status === 'UNREAD' ? <Button loading={saving} onClick={() => read(detail)}>标为已读</Button> : null}>
      {error && <Alert type="error" showIcon title={error} />}
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail?.body}</p>
      <small>{workflowTime(detail?.createdAt)}</small>
    </Modal>
  </>;
}
