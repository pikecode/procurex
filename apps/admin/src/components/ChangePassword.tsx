import { useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Tooltip } from 'antd';
import { KeyRound } from 'lucide-react';
import { clearSession, request } from '../lib/api';

export function ChangePassword({ signedOut }: { signedOut: () => void }) {
  const [open, setOpen] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [form] = Form.useForm(); const { message } = App.useApp();
  const save = async () => {
    if (saving) return;
    const value = await form.validateFields().catch(() => null); if (!value) return;
    setSaving(true); setError('');
    try {
      await request('/auth/password', { method: 'POST', body: { currentPassword: value.currentPassword, password: value.password } });
      form.resetFields(); setOpen(false); clearSession(); message.success('密码已修改，请使用新密码重新登录'); signedOut();
    } catch (failure) { setError((failure as Error).message); } finally { setSaving(false); }
  };
  return <><Tooltip title="修改密码"><Button type="text" aria-label="修改密码" icon={<KeyRound size={17} />} onClick={() => { form.resetFields(); setError(''); setOpen(true); }} /></Tooltip>
    <Modal title="修改密码" open={open} onCancel={() => !saving && setOpen(false)} onOk={save} confirmLoading={saving} maskClosable={false} okText="确认修改" cancelText="取消">
      <Alert type="info" showIcon title="修改后，全部登录会话将退出，需要重新登录。" />{error && <Alert type="error" showIcon title={error} />}
      <Form form={form} layout="vertical" disabled={saving}>
        <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true }]}><Input.Password autoComplete="current-password" maxLength={128} /></Form.Item>
        <Form.Item name="password" label="新密码" rules={[{ required: true }, { min: 8, max: 128, message: '密码需为8至128位' }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item name="confirmPassword" label="确认新密码" dependencies={['password']} rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, value) => value === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error('两次密码不一致')) })]}><Input.Password autoComplete="new-password" /></Form.Item>
      </Form>
    </Modal></>;
}
