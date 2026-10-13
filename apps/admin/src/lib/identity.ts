import type { User } from './api';

// 角色与归属范围的中文表述。Users.tsx 的角色下拉、顶栏身份区共用这一份，
// 避免同一个角色在不同页面出现两种叫法。
export const roleLabels: Record<string, string> = {
  ADMIN: '系统管理员', PURCHASER: '采购经理', PURCHASE_FOLLOWER: '采购跟单',
  HQ_FINANCE: '总部财务', REGION_FINANCE: '区域财务', REGION_MANAGER: '区域经理',
  STORE: '门店厨政经理', STORE_FINANCE: '门店财务', SUPPLIER: '供应商',
};

export const roleLabel = (role: string) => roleLabels[role] || role;

const scopeLabel = (user: User) => {
  if (user.scope?.type === 'SUPPLIER') return '所属供应商';
  if (user.scope?.type === 'MULTI_STORE') return `授权门店 ${user.scope.storeIds?.length || 0} 家`;
  if (user.scope?.type) return '所属门店';
  return '';
};

/** 顶栏身份区的一行说明：角色在前，归属在后。没有角色或归属时返回空串。 */
export function identitySummary(user: User) {
  const roles = (user.roles || []).map(roleLabel);
  const scope = scopeLabel(user);
  if (!roles.length) return scope;
  if (!scope) return roles.join(' · ');
  return `${roles.join(' · ')} · ${scope}`;
}

/** 头像里的单字：中文取第一个字，英文取首字母。 */
export function initialOf(name: string) {
  const trimmed = (name || '').trim();
  return trimmed ? [...trimmed][0]!.toUpperCase() : '·';
}

// 头像底色。按用户 id 稳定散列，同一账号每次进来颜色一致，
// 共享终端和截图里能一眼分清是谁在看。
// 只取冷色：顶栏右侧紧邻通知角标（红）与错误态，红/橙头像会被误读成状态。
// 五个色都验算过：白字压上去均 ≥4.5:1。
const avatarPalette = ['#147d64', '#2a7d8c', '#3a5fa8', '#6d4ba8', '#556070'];

export function avatarColor(seed: string) {
  const key = seed || '';
  let hash = 0;
  for (let index = 0; index < key.length; index++) hash = (hash * 31 + key.charCodeAt(index)) | 0;
  return avatarPalette[Math.abs(hash) % avatarPalette.length]!;
}