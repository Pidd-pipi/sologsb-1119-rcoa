import { create } from 'zustand';
import { WORK_USERS, type WorkUser } from '../types/auth';

const LS_USER_KEY = 'gbfossilprep:current-user';

function readInitialUser(): WorkUser {
  try {
    const raw = window.localStorage.getItem(LS_USER_KEY);
    if (raw) {
      const found = WORK_USERS.find((u) => u.name === raw);
      if (found) return found;
    }
  } catch {
    /* localStorage 不可用时回落到默认账号 */
  }
  return WORK_USERS[0];
}

interface AuthState {
  current: WorkUser;
  switchUser: (name: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  current: readInitialUser(),
  switchUser(name) {
    const found = WORK_USERS.find((u) => u.name === name);
    if (!found) return;
    try {
      window.localStorage.setItem(LS_USER_KEY, found.name);
    } catch {
      /* 忽略持久化失败 */
    }
    set({ current: found });
  },
}));
