import type { SupplyLot, SupplyRequest } from '../types/supply';

/** 单条申请的占用推导结果 */
export interface RequestView {
  request: SupplyRequest;
  /**
   * FIFO 排队后该申请是否排得下：
   * true = 占用中（待确认占用，计入待确认量）；false = 排队中（等待名次）
   */
  occupy: boolean;
  /** 等待名次（从 1 起，按提交顺序）；占用中同样返回其顺位 */
  queuePos: number;
}

/** 批次可用量 / 待确认量推导结果 */
export interface LotAvailability {
  lotId: string;
  /** 待确认占用量（仅含 FIFO 中排得下的申请） */
  heldQty: number;
  /** 可用量 = 在库 - 待确认占用量（不为负） */
  availableQty: number;
  /** 待确认申请数（含排队中） */
  activeCount: number;
  views: RequestView[];
}

/** 某批次的待确认申请，按提交时间先后排序（先提交优先） */
export function activeRequestsOf(lotId: string, requests: SupplyRequest[]): SupplyRequest[] {
  return requests
    .filter((r) => r.lotId === lotId && r.status === 'pending')
    .sort((a, b) => a.submittedAt - b.submittedAt || a.id.localeCompare(b.id));
}

/**
 * 推导批次的可用量、待确认量与每条申请的等待名次。
 * 同一批次容量不足时按提交顺序排队：先提交的申请优先占用，
 * 后提交或改大的用量不能挤掉前面的申请。
 * 纯函数，材料台账与工序页共用同一口径，保证显示一致。
 */
export function deriveLotAvailability(lot: SupplyLot, requests: SupplyRequest[]): LotAvailability {
  const active = activeRequestsOf(lot.id, requests);
  let cum = 0;
  const views: RequestView[] = active.map((r, i) => {
    const occupy = cum + r.qty <= lot.qty;
    if (occupy) cum += r.qty;
    return { request: r, occupy, queuePos: i + 1 };
  });
  return {
    lotId: lot.id,
    heldQty: cum,
    availableQty: Math.max(0, lot.qty - cum),
    activeCount: active.length,
    views,
  };
}

/** 某工序关联的全部申请（任意状态），按提交顺序排列 */
export function requestsOfProcedure(procedureId: string, requests: SupplyRequest[]): SupplyRequest[] {
  return requests
    .filter((r) => r.procedureId === procedureId)
    .sort((a, b) => a.submittedAt - b.submittedAt || a.id.localeCompare(b.id));
}

/** 全部批次的待确认申请总数（台账徽标用） */
export function totalActiveRequests(requests: SupplyRequest[]): number {
  return requests.filter((r) => r.status === 'pending').length;
}
