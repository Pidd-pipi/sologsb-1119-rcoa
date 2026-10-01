import { create } from 'zustand';

/**
 * 复核权限角色：
 * - technician 技师：可提交用量申请，无权确认领用（越权确认会被拒绝）
 * - reviewer 复核员：可确认申请转为正式领用 / 拒绝申请
 */
export type Role = 'technician' | 'reviewer';

const LS_ROLE_KEY = 'gbfossilprep:role';

function readRole(): Role {
  try {
    return window.localStorage.getItem(LS_ROLE_KEY) === 'reviewer' ? 'reviewer' : 'technician';
  } catch {
    return 'technician';
  }
}

interface RoleState {
  role: Role;
  setRole: (role: Role) => void;
}

export const useRoleStore = create<RoleState>((set) => ({
  role: readRole(),
  setRole: (role) => {
    try {
      window.localStorage.setItem(LS_ROLE_KEY, role);
    } catch {
      /* localStorage 不可用时忽略 */
    }
    set({ role });
  },
}));

export const ROLE_LABEL: Record<Role, string> = {
  technician: '技师',
  reviewer: '复核员',
};
