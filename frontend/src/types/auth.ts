/** 工作台角色：技师只能提交/撤销/改量；复核人可确认正式领用 */
export type WorkRole = 'technician' | 'reviewer';

export const WORK_ROLE_LABEL: Record<WorkRole, string> = {
  technician: '技师',
  reviewer: '复核人',
};

export interface WorkUser {
  name: string;
  role: WorkRole;
}

/** 内置账号：技师 3 名 + 有复核权限的修复组长 1 名 */
export const WORK_USERS: WorkUser[] = [
  { name: '林砚秋', role: 'technician' },
  { name: '沈归白', role: 'technician' },
  { name: '陆鸣时', role: 'technician' },
  { name: '周明允', role: 'reviewer' },
];

export function canReviewAdhesive(role: WorkRole): boolean {
  return role === 'reviewer';
}
