import type { SupplyLot } from '../types/supply';
import type { AdhesiveRequest } from '../types/adhesive';

/** 参与排队的申请：已占名额待确认 + 排队等待（confirmed/released 不再占用容量） */
export function isActiveRequest(req: Pick<AdhesiveRequest, 'status'>): boolean {
  return req.status === 'held' || req.status === 'waiting';
}

export function lotActiveRequests(
  lotId: string,
  requests: AdhesiveRequest[],
): AdhesiveRequest[] {
  return requests
    .filter((r) => r.supplyLotId === lotId && isActiveRequest(r))
    .sort((a, b) => a.submittedAt - b.submittedAt || a.id.localeCompare(b.id));
}

/**
 * 同一批次的严格 FIFO 重排：
 * 按提交时间先后依次占位，容量内为 held；一旦遇到某笔装不下，
 * 其后所有申请一律 waiting——即使零头容量够后笔使用，也不能越过队首等待者。
 * 后提交或后来改大的用量不能挤掉前面申请：改量不改 submittedAt，全量重排后
 * 更早的申请永远先选。
 *
 * @returns 状态需变更的申请 id -> 新状态（调用方据此写库）
 */
export function reallocate(
  lot: Pick<SupplyLot, 'id' | 'qty'>,
  requests: AdhesiveRequest[],
): Map<string, 'held' | 'waiting'> {
  let remaining = lot.qty;
  let blocked = false;
  const result = new Map<string, 'held' | 'waiting'>();
  for (const req of lotActiveRequests(lot.id, requests)) {
    if (!blocked && req.qty <= remaining) {
      remaining -= req.qty;
      result.set(req.id, 'held');
    } else {
      blocked = true;
      result.set(req.id, 'waiting');
    }
  }
  return result;
}

export interface LotAllocation {
  /** 在库（账面总量，正式领用确认后才扣减） */
  qty: number;
  /** 待确认占用量：held 申请用量合计 */
  heldQty: number;
  /** 可用量：在库 - 待确认占用（waiting 不扣可用量） */
  available: number;
  /** 排队等待量 */
  waitingQty: number;
  /** 排队等待申请数 */
  waitingCount: number;
}

/** 台账页与工序页共用的唯一口径 */
export function getLotAllocation(
  lot: Pick<SupplyLot, 'id' | 'qty'>,
  requests: AdhesiveRequest[],
): LotAllocation {
  const active = lotActiveRequests(lot.id, requests);
  let heldQty = 0;
  let waitingQty = 0;
  let waitingCount = 0;
  for (const req of active) {
    if (req.status === 'held') heldQty += req.qty;
    else {
      waitingQty += req.qty;
      waitingCount += 1;
    }
  }
  return {
    qty: lot.qty,
    heldQty,
    available: lot.qty - heldQty,
    waitingQty,
    waitingCount,
  };
}

/** 全局待确认占用（按批次汇总），台账头部统计用 */
export function totalHeldQty(lots: SupplyLot[], requests: AdhesiveRequest[]): number {
  return lots.reduce(
    (sum, lot) => sum + getLotAllocation(lot, requests).heldQty,
    0,
  );
}

/**
 * 等待名次：排队申请在同批次 waiting 队列中按提交时间的次序（1 起，即“前面再走几笔就轮到”）。
 * held / 非等待状态返回 undefined。
 */
export function waitingRank(
  req: AdhesiveRequest,
  requests: AdhesiveRequest[],
): number | undefined {
  if (req.status !== 'waiting') return undefined;
  const waiting = lotActiveRequests(req.supplyLotId, requests).filter((r) => r.status === 'waiting');
  const idx = waiting.findIndex((r) => r.id === req.id);
  return idx >= 0 ? idx + 1 : undefined;
}
