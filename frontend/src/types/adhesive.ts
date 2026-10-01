import type { SupplyLot } from './supply';

/**
 * 受控胶种用量申请状态：
 * - held：待确认占用（已按 FIFO 占到名额，库存尚未扣减，等待复核人确认）
 * - waiting：批次容量不足，排队等待中
 * - confirmed：已复核确认，转为正式领用（库存已扣、台账已记）
 * - released：占用已释放（技师撤销 / 工序回退 / 工序移除）
 */
export type AdhesiveRequestStatus = 'held' | 'waiting' | 'confirmed' | 'released';

export const ADHESIVE_REQUEST_STATUS_LABEL: Record<AdhesiveRequestStatus, string> = {
  held: '待确认占用',
  waiting: '排队等待',
  confirmed: '已正式领用',
  released: '已释放',
};

export interface AdhesiveRequest {
  id: string;
  /** 申请的胶种批次 */
  supplyLotId: string;
  /** 批次快照（批号可能被改名，留痕以申请时为准） */
  supplyLotName: string;
  supplyLotSpec: string;
  lotNo: string;
  unit: string;
  /** 所属工序 */
  procedureId: string;
  /** 所属标本（快照） */
  specimenId: string;
  specimenNo: string;
  /** 申请用量 */
  qty: number;
  status: AdhesiveRequestStatus;
  /** 提交技师 */
  applicant: string;
  /** 提交时间——同批次排队的唯一先后依据，改用量也不变 */
  submittedAt: number;
  updatedAt: number;
  /** 复核人 / 复核时间 */
  confirmer?: string;
  confirmedAt?: number;
  releasedAt?: number;
  releaseReason?: 'cancel' | 'procedure_rollback' | 'procedure_remove';
}

export type AdhesiveRequestDraft = Pick<
  AdhesiveRequest,
  'supplyLotId' | 'procedureId' | 'specimenId' | 'specimenNo' | 'qty' | 'applicant'
>;

/** 从批次生成申请快照字段 */
export function lotSnapshot(lot: SupplyLot): Pick<
  AdhesiveRequest,
  'supplyLotId' | 'supplyLotName' | 'supplyLotSpec' | 'lotNo' | 'unit'
> {
  return {
    supplyLotId: lot.id,
    supplyLotName: lot.name,
    supplyLotSpec: lot.spec,
    lotNo: lot.lotNo,
    unit: lot.unit,
  };
}
