/** 工具材料种类 */
export type SupplyKind = '工具' | '磨料' | '胶种' | '耗材';

export const SUPPLY_KINDS: SupplyKind[] = ['工具', '磨料', '胶种', '耗材'];

/** 工具材料批次 */
export interface SupplyLot {
  id: string;
  name: string;
  kind: SupplyKind;
  /** 规格 */
  spec: string;
  /** 批号 */
  lotNo: string;
  /** 在库数量 */
  qty: number;
  unit: string;
  /** 开封时间 */
  openedAt: number;
  /** 保质期（月） */
  shelfLifeMonths: number;
  /** 低量阈值 */
  lowThreshold: number;
  /** 最近一次领用记录 */
  issues: SupplyIssue[];
}

/** 领用登记（正式领用，库存已扣减） */
export interface SupplyIssue {
  id: string;
  qty: number;
  operator: string;
  specimenNo: string;
  issuedAt: number;
}

/** 受控胶种用量申请状态 */
export type SupplyRequestStatus =
  | 'pending' // 待确认占用：已占用额度，库存未扣减
  | 'confirmed' // 已确认：转为正式领用，库存已扣减
  | 'rejected' // 已拒绝（含越权确认被拒）
  | 'released'; // 已释放（工序回退/移除时释放占用）

/**
 * 受控胶种用量申请。
 * 技师在工序中按批号提交，先生成「待确认占用」，库存不立即扣；
 * 有复核权限的人确认后才转为正式领用（SupplyIssue）。
 */
export interface SupplyRequest {
  id: string;
  lotId: string;
  procedureId: string;
  specimenId: string;
  specimenNo: string;
  /** 申请用量 */
  qty: number;
  unit: string;
  status: SupplyRequestStatus;
  requestedBy: string;
  /** 提交时间，决定排队先后顺序（FIFO） */
  submittedAt: number;
  confirmedAt?: number;
  confirmedBy?: string;
  /** 确认后生成的正式领用记录 id */
  issueId?: string;
  rejectReason?: string;
  releasedAt?: number;
}

export type SupplyLotDraft = Omit<SupplyLot, 'id' | 'issues'>;

/** 是否低量 */
export function isLowStock(lot: SupplyLot): boolean {
  return lot.qty <= lot.lowThreshold;
}

/** 剩余保质期天数（负数表示已过期） */
export function shelfLifeLeftDays(lot: SupplyLot, now = Date.now()): number {
  const expireAt = lot.openedAt + lot.shelfLifeMonths * 30 * 24 * 3600 * 1000;
  return Math.floor((expireAt - now) / (24 * 3600 * 1000));
}
