import type { ReactNode } from 'react';
import { Button, Dropdown, Modal, Tooltip, type MenuProps } from 'antd';
import { MoreHorizontal } from 'lucide-react';

export interface RowAction {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** 禁用原因。禁用的按钮不加解释就只是一个"点不动"，用户无从判断该先做什么。 */
  disabledReason?: string;
  /** 需要二次确认。菜单项里不能内嵌 Popconfirm（点一下菜单就关了），统一走 Modal.confirm。 */
  confirm?: { title: string; description?: ReactNode; okText?: string; cancelText?: string };
}

// 两个动作以内全部平铺：套一层下拉反而多一次点击。
// 三个及以上时只把最高频的那个留在外面，其余收进「更多」。
const FLAT_LIMIT = 2;

export function RowActions({ actions, ariaLabel }: { actions: (RowAction | false | null | undefined)[]; ariaLabel?: string }) {
  const items = actions.filter((action): action is RowAction => Boolean(action));
  if (!items.length) return <span className="row-actions-empty">—</span>;
  const run = (action: RowAction) => {
    if (!action.onClick) return;
    if (action.confirm) {
      Modal.confirm({ title: action.confirm.title, content: action.confirm.description,
        okText: action.confirm.okText ?? '确认', cancelText: action.confirm.cancelText ?? '取消',
        okButtonProps: { danger: action.danger }, onOk: action.onClick });
      return;
    }
    action.onClick();
  };
  const flat = items.length <= FLAT_LIMIT ? items : items.slice(0, 1);
  const overflow = items.slice(flat.length);
  const menuItems: MenuProps['items'] = overflow.map(action => ({
    key: action.key, label: action.label, icon: action.icon, danger: action.danger, disabled: action.disabled }));
  const link = (action: RowAction) => {
    const button = <Button type="link" icon={action.icon} disabled={action.disabled} danger={action.danger}
      aria-label={ariaLabel ? `${action.label}${ariaLabel}` : action.label} onClick={() => run(action)}>{action.label}</Button>;
    return action.disabled && action.disabledReason ? <Tooltip key={action.key} title={action.disabledReason}>{button}</Tooltip> : <span key={action.key}>{button}</span>;
  };
  return <div className="row-actions">
    {flat.map(link)}
    {overflow.length ? <Dropdown trigger={['click']} menu={{ items: menuItems, onClick: ({ key }) => run(overflow.find(action => action.key === key)!) }}>
      <Button type="text" className="row-actions-more" aria-label={ariaLabel ? `更多操作${ariaLabel}` : '更多操作'}
        icon={<MoreHorizontal size={18} />} />
    </Dropdown> : null}
  </div>;
}