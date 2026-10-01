import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import { useAdhesiveStore } from './adhesiveStore';
import type { PrepProcedure, PrepProcedureDraft } from '../types/procedure';

interface ProcedureState {
  items: PrepProcedure[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: PrepProcedureDraft) => Promise<PrepProcedure>;
  finish: (id: string) => Promise<void>;
  rollback: (id: string, reason?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  bySpecimen: (specimenId: string) => PrepProcedure[];
}

export const useProcedureStore = create<ProcedureState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const items = await db.procedures.toArray();
    items.sort((a, b) => a.seq - b.seq || a.startedAt - b.startedAt);
    set({ items, loaded: true });
  },
  async add(draft) {
    const record: PrepProcedure = { ...draft, id: newId('prc') };
    await db.procedures.put(record);
    set({ items: [...get().items, record] });
    return record;
  },
  async finish(id) {
    const patch: Partial<PrepProcedure> = { state: 'done', finishedAt: Date.now() };
    await db.procedures.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async rollback(id) {
    const patch: Partial<PrepProcedure> = { state: 'rolledback', finishedAt: undefined };
    await db.procedures.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
    // 受控胶种：工序回退时释放该节点的待确认占用并触发排队补位
    await useAdhesiveStore.getState().releaseByProcedure(id, 'procedure_rollback');
  },
  async remove(id) {
    await db.procedures.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
    // 受控胶种：工序移除时同样释放占用
    await useAdhesiveStore.getState().releaseByProcedure(id, 'procedure_remove');
  },
  bySpecimen(specimenId) {
    return get()
      .items.filter((it) => it.specimenId === specimenId)
      .sort((a, b) => a.seq - b.seq);
  },
}));
