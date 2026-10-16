import { useCallback, useRef } from 'react';
import type { FormInstance } from 'antd';
import { App } from 'antd';

/**
 * 表单未保存拦截。Templates 页原本是这个逻辑的单点实现，
 * 八个编辑器各自复制一遍既不一致也容易漏，抽到这里统一。
 *
 * 用法：
 *   const guard = useUnsavedGuard(form);
 *   guard.snapshot();                 // 打开/载入数据后记录基线
 *   if (!await guard.confirmDiscard()) return;   // 关闭前拦截
 */
export function useUnsavedGuard(form: FormInstance | null | undefined) {
  const baseline = useRef('');
  const { modal } = App.useApp();

  /** 记录当前表单状态为基线。打开弹窗或载入数据后调用。 */
  const snapshot = useCallback(() => {
    if (!form) return;
    baseline.current = safeSerialize(form);
  }, [form]);

  const isDirty = useCallback(() => Boolean(form) && safeSerialize(form!) !== baseline.current, [form]);

  /** 有未保存修改时弹确认框。返回 true 表示可以安全关闭。 */
  const confirmDiscard = useCallback(async () => {
    if (!isDirty()) return true;
    return new Promise<boolean>(resolve => {
      modal.confirm({
        title: '放弃未保存的修改？',
        content: '当前修改尚未保存，关闭后将丢失。',
        okText: '放弃修改', cancelText: '继续编辑', okButtonProps: { danger: true },
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }, [isDirty, modal]);

  return { snapshot, isDirty, confirmDiscard };
}

function safeSerialize(form: FormInstance) {
  try {
    return JSON.stringify(form.getFieldsValue(true));
  } catch {
    // 循环引用等极端情况退化为「干净」，宁可少拦一次也不要卡住关闭
    return '';
  }
}