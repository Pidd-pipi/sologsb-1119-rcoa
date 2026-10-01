import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import type { SupplyIssue, SupplyLot, SupplyLotDraft, SupplyRequest } from '../types/supply';
import { deriveLotAvailability } from '../utils/supplyRequests';
import type { Role } from './roleStore';

export interface SupplyRequestInput {
  lotId: string;
  procedureId: string;
  specimenId: string;
  specimenNo: string;
  qty: number;
  requestedBy: string;
}

interface SupplyState {
  items: SupplyLot[];
  requests: SupplyRequest[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: SupplyLotDraft) => Promise<SupplyLot>;
  /** 非受控材料的直接领用登记 */
  issue: (id: string, payload: Omit<SupplyIssue, 'id' | 'issuedAt'>) => Promise<void>;
  trace: (lotNo: string) => SupplyLot[];
  /** 技师提交受控胶种用量申请（形成待确认占用，库存不立即扣） */
  submitRequest: (input: SupplyRequestInput) => Promise<SupplyRequest>;
  /** 技师改大/改小申请用量（保留提交顺位，不能挤掉前面的申请） */
  updateRequestQty: (id: string, qty: number) => Promise<void>;
  /** 复核确认：转为正式领用并扣减库存；权限不足时拒绝 */
  confirmRequest: (id: string, role: Role) => Promise<void>;
  /** 复核拒绝 */
  rejectRequest: (id: string, reason?: string) => Promise<void>;
  /** 工序回退/移除时释放该工序下的待确认占用 */
  releaseByProcedure: (procedureId: string) => Promise<void>;
}

export const useSupplyStore = create<SupplyState>((set, get) => ({
  items: [],
  requests: [],
  loaded: false,
  async load() {
    const [items, requests] = await Promise.all([db.supplies.toArray(), db.requests.toArray()]);
    items.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    requests.sort((a, b) => a.submittedAt - b.submittedAt || a.id.localeCompare(b.id));
    set({ items, requests, loaded: true });
  },
  async add(draft) {
    const record: SupplyLot = { ...draft, id: newId('sup'), issues: [] };
    await db.supplies.put(record);
    set({ items: [...get().items, record] });
    return record;
  },
  async issue(id, payload) {
    const target = get().items.find((it) => it.id === id);
    if (!target) return;
    const issue: SupplyIssue = { ...payload, id: newId('iss'), issuedAt: Date.now() };
    const next: SupplyLot = {
      ...target,
      qty: Math.max(0, target.qty - payload.qty),
      issues: [issue, ...target.issues],
    };
    await db.supplies.put(next);
    set({ items: get().items.map((it) => (it.id === id ? next : it)) });
  },
  trace(lotNo) {
    if (!lotNo) return get().items;
    return get().items.filter((it) => it.lotNo.includes(lotNo) || it.name.includes(lotNo));
  },
  async submitRequest(input) {
    const lot = get().items.find((it) => it.id === input.lotId);
    if (!lot) throw new Error('所选批次不存在');
    if (!Number.isFinite(input.qty) || input.qty <= 0) throw new Error('申请用量必须大于 0');
    const record: SupplyRequest = {
      id: newId('srq'),
      lotId: input.lotId,
      procedureId: input.procedureId,
      specimenId: input.specimenId,
      specimenNo: input.specimenNo,
      qty: input.qty,
      unit: lot.unit,
      status: 'pending',
      requestedBy: input.requestedBy,
      submittedAt: Date.now(),
    };
    await db.requests.put(record);
    set({ requests: [...get().requests, record] });
    return record;
  },
  async updateRequestQty(id, qty) {
    const req = get().requests.find((r) => r.id === id);
    if (!req || req.status !== 'pending') return;
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('申请用量必须大于 0');
    // submittedAt 不变 → 排队顺位保留，改大的用量不能挤掉前面的申请
    const next: SupplyRequest = { ...req, qty };
    await db.requests.put(next);
    set({ requests: get().requests.map((r) => (r.id === id ? next : r)) });
  },
  async confirmRequest(id, role) {
    const req = get().requests.find((r) => r.id === id);
    if (!req || req.status !== 'pending') return;
    if (role !== 'reviewer') {
      // 权限不足：拒绝该申请
      await get().rejectRequest(id, '复核权限不足，技师无权确认');
      throw new Error('无复核权限，该申请已被拒绝');
    }
    const lot = get().items.find((it) => it.id === req.lotId);
    if (!lot) return;
    const { views } = deriveLotAvailability(lot, get().requests);
    const view = views.find((v) => v.request.id === id);
    if (!view || !view.occupy) {
      throw new Error('该申请排队中，暂无可占用库存，不能确认领用');
    }
    const issue: SupplyIssue = {
      id: newId('iss'),
      qty: req.qty,
      operator: req.requestedBy,
      specimenNo: req.specimenNo,
      issuedAt: Date.now(),
    };
    const nextLot: SupplyLot = {
      ...lot,
      qty: Math.max(0, lot.qty - req.qty),
      issues: [issue, ...lot.issues],
    };
    const nextReq: SupplyRequest = {
      ...req,
      status: 'confirmed',
      confirmedAt: Date.now(),
      confirmedBy: '复核员',
      issueId: issue.id,
    };
    await db.transaction('rw', db.supplies, db.requests, async () => {
      await db.supplies.put(nextLot);
      await db.requests.put(nextReq);
    });
    set({
      items: get().items.map((it) => (it.id === lot.id ? nextLot : it)),
      requests: get().requests.map((r) => (r.id === id ? nextReq : r)),
    });
  },
  async rejectRequest(id, reason) {
    const req = get().requests.find((r) => r.id === id);
    if (!req || req.status !== 'pending') return;
    const next: SupplyRequest = { ...req, status: 'rejected', rejectReason: reason ?? '复核拒绝' };
    await db.requests.put(next);
    set({ requests: get().requests.map((r) => (r.id === id ? next : r)) });
  },
  async releaseByProcedure(procedureId) {
    const mine = get().requests.filter((r) => r.procedureId === procedureId && r.status === 'pending');
    if (mine.length === 0) return;
    const releasedAt = Date.now();
    const updated: SupplyRequest[] = mine.map((r) => ({ ...r, status: 'released', releasedAt }));
    await db.requests.bulkPut(updated);
    const byId = new Map(updated.map((r) => [r.id, r]));
    set({ requests: get().requests.map((r) => byId.get(r.id) ?? r) });
  },
}));
