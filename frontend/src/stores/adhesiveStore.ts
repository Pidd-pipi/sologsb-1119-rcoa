import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import { reallocate } from '../utils/allocation';
import { lotSnapshot, type AdhesiveRequest, type AdhesiveRequestDraft } from '../types/adhesive';
import { useSupplyStore } from './supplyStore';

/** 受控胶种申请流程错误（权限不足、状态冲突等，消息直接提示给用户） */
export class AdhesiveFlowError extends Error {}

interface AdhesiveState {
  items: AdhesiveRequest[];
  loaded: boolean;
  load: () => Promise<void>;
  /** 技师提交用量申请：不扣库存，按 FIFO 形成占用或排队 */
  submit: (draft: AdhesiveRequestDraft) => Promise<AdhesiveRequest>;
  /** 修改用量：保留原提交时间，不因此插队 */
  amend: (id: string, qty: number) => Promise<void>;
  /** 技师撤销申请 */
  cancel: (id: string) => Promise<void>;
  /** 复核人确认：转正式领用、扣减在库、写入材料台账；权限不足时拒绝 */
  confirm: (id: string, confirmer: string, confirmerRole: string) => Promise<void>;
  /** 工序回退 / 移除时级联释放该工序的全部占用并补位 */
  releaseByProcedure: (
    procedureId: string,
    reason: 'procedure_rollback' | 'procedure_remove',
  ) => Promise<void>;
  byProcedure: (procedureId: string) => AdhesiveRequest[];
  byLot: (lotId: string) => AdhesiveRequest[];
}

const sortByTime = (list: AdhesiveRequest[]): AdhesiveRequest[] =>
  [...list].sort((a, b) => a.submittedAt - b.submittedAt || a.id.localeCompare(b.id));

export const useAdhesiveStore = create<AdhesiveState>((set, get) => {
  /** 事务内对某批次做 FIFO 全量重排并写回 */
  async function persistReallocation(lotId: string): Promise<void> {
    const [lot, requests] = await Promise.all([
      db.supplies.get(lotId),
      db.adhesives.where('supplyLotId').equals(lotId).toArray(),
    ]);
    if (!lot) return;
    const plan = reallocate(lot, requests);
    for (const req of requests) {
      const next = plan.get(req.id);
      if (next && req.status !== next) {
        await db.adhesives.update(req.id, { status: next });
      }
    }
  }

  /** 从库表重读两个 store，保证台账与工序页看到同一组数字 */
  async function refreshStores(): Promise<void> {
    const [lots, requests] = await Promise.all([db.supplies.toArray(), db.adhesives.toArray()]);
    lots.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    requests.sort((a, b) => a.submittedAt - b.submittedAt || a.id.localeCompare(b.id));
    useSupplyStore.setState({ items: lots });
    set({ items: requests });
  }

  return {
    items: [],
    loaded: false,
    async load() {
      const items = await db.adhesives.toArray();
      items.sort((a, b) => a.submittedAt - b.submittedAt || a.id.localeCompare(b.id));
      set({ items, loaded: true });
    },
    async submit(draft) {
      if (!(Number.isFinite(draft.qty) && draft.qty > 0)) {
        throw new AdhesiveFlowError('申请用量必须大于 0');
      }
      const lot = await db.supplies.get(draft.supplyLotId);
      if (!lot) throw new AdhesiveFlowError('所选材料批次不存在');
      if (lot.kind !== '胶种') throw new AdhesiveFlowError('仅受控胶种需要按批号申请用量');
      if (draft.qty > lot.qty) {
        throw new AdhesiveFlowError(`申请用量不能超过批次总量 ${lot.qty} ${lot.unit}`);
      }
      const procedure = await db.procedures.get(draft.procedureId);
      if (!procedure) throw new AdhesiveFlowError('所属工序不存在或已移除');

      const now = Date.now();
      const record: AdhesiveRequest = {
        id: newId('adh'),
        ...lotSnapshot(lot),
        specimenId: draft.specimenId,
        specimenNo: draft.specimenNo,
        procedureId: draft.procedureId,
        qty: draft.qty,
        status: 'waiting',
        applicant: draft.applicant,
        submittedAt: now,
        updatedAt: now,
      };

      await db.transaction('rw', [db.supplies, db.adhesives], async () => {
        await db.adhesives.put(record);
        await persistReallocation(lot.id);
      });
      await refreshStores();
      return get().items.find((it) => it.id === record.id) ?? record;
    },
    async amend(id, qty) {
      if (!(Number.isFinite(qty) && qty > 0)) {
        throw new AdhesiveFlowError('申请用量必须大于 0');
      }
      const req = await db.adhesives.get(id);
      if (!req) throw new AdhesiveFlowError('申请不存在');
      if (req.status !== 'held' && req.status !== 'waiting') {
        throw new AdhesiveFlowError('该申请已结束，不能修改用量');
      }
      const lot = await db.supplies.get(req.supplyLotId);
      if (!lot) throw new AdhesiveFlowError('所属批次不存在');
      if (qty > lot.qty) {
        throw new AdhesiveFlowError(`申请用量不能超过批次总量 ${lot.qty} ${lot.unit}`);
      }
      await db.transaction('rw', [db.supplies, db.adhesives], async () => {
        // submittedAt 保持不变：改大用量也不能挤掉更早提交的申请
        await db.adhesives.update(id, { qty, updatedAt: Date.now() });
        await persistReallocation(req.supplyLotId);
      });
      await refreshStores();
    },
    async cancel(id) {
      const req = await db.adhesives.get(id);
      if (!req) throw new AdhesiveFlowError('申请不存在');
      if (req.status !== 'held' && req.status !== 'waiting') {
        throw new AdhesiveFlowError('该申请已结束，不能撤销');
      }
      await db.transaction('rw', [db.supplies, db.adhesives], async () => {
        await db.adhesives.update(id, {
          status: 'released',
          releasedAt: Date.now(),
          releaseReason: 'cancel',
        });
        await persistReallocation(req.supplyLotId);
      });
      await refreshStores();
    },
    async confirm(id, confirmer, confirmerRole) {
      if (confirmerRole !== 'reviewer') {
        throw new AdhesiveFlowError('权限不足：仅复核人可确认胶种领用，申请保持待确认状态');
      }
      const req = await db.adhesives.get(id);
      if (!req) throw new AdhesiveFlowError('申请不存在');
      if (req.status === 'confirmed') throw new AdhesiveFlowError('该申请已确认');
      if (req.status === 'released') throw new AdhesiveFlowError('该申请已释放，不能确认');
      if (req.status === 'waiting') {
        throw new AdhesiveFlowError('该申请仍在排队，容量到位后才能确认');
      }
      const lot = await db.supplies.get(req.supplyLotId);
      if (!lot) throw new AdhesiveFlowError('所属批次不存在');
      if (lot.qty < req.qty) {
        // held 正常情况下不会出现，防御性处理：重新排队
        await db.transaction('rw', [db.supplies, db.adhesives], async () => {
          await persistReallocation(lot.id);
        });
        await refreshStores();
        throw new AdhesiveFlowError('批次容量已变化，该申请已回到排队队列');
      }

      await db.transaction('rw', [db.supplies, db.adhesives], async () => {
        await db.supplies.update(lot.id, {
          qty: lot.qty - req.qty,
          issues: [
            {
              id: newId('iss'),
              qty: req.qty,
              operator: confirmer,
              specimenNo: req.specimenNo,
              issuedAt: Date.now(),
            },
            ...lot.issues,
          ],
        });
        await db.adhesives.update(id, {
          status: 'confirmed',
          confirmer,
          confirmedAt: Date.now(),
          updatedAt: Date.now(),
        });
        // 扣减后重新排队：若后续 waiting 申请此时能装下则补位
        await persistReallocation(lot.id);
      });
      await refreshStores();
    },
    async releaseByProcedure(procedureId, reason) {
      const active = await db.adhesives.where('procedureId').equals(procedureId).toArray();
      const targets = active.filter((r) => r.status === 'held' || r.status === 'waiting');
      if (targets.length === 0) return;
      const lotIds = [...new Set(targets.map((r) => r.supplyLotId))];
      const now = Date.now();
      await db.transaction('rw', [db.supplies, db.adhesives], async () => {
        for (const req of targets) {
          await db.adhesives.update(req.id, {
            status: 'released',
            releasedAt: now,
            releaseReason: reason,
          });
        }
        for (const lotId of lotIds) {
          await persistReallocation(lotId);
        }
      });
      await refreshStores();
    },
    byProcedure(procedureId) {
      return sortByTime(get().items.filter((r) => r.procedureId === procedureId));
    },
    byLot(lotId) {
      return sortByTime(get().items.filter((r) => r.supplyLotId === lotId));
    },
  };
});
