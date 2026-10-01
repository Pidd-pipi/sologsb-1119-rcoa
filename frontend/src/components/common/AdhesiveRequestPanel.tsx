import { useMemo, useState } from 'react';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import LockIcon from '@mui/icons-material/Lock';
import { useSupplyStore } from '../../stores/supplyStore';
import { useAdhesiveStore, AdhesiveFlowError } from '../../stores/adhesiveStore';
import { useAuthStore } from '../../stores/authStore';
import { getLotAllocation, waitingRank } from '../../utils/allocation';
import { ADHESIVE_REQUEST_STATUS_LABEL, type AdhesiveRequest } from '../../types/adhesive';
import { MeasureField } from './MeasureField';

export interface AdhesiveRequestPanelProps {
  procedureId: string;
  specimenId: string;
  specimenNo: string;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_COLOR: Record<AdhesiveRequest['status'], 'success' | 'warning' | 'info' | 'default'> = {
  held: 'warning',
  waiting: 'info',
  confirmed: 'success',
  released: 'default',
};

/**
 * 工序节点内的受控胶种用量申请面板：
 * 技师按批号提交申请（不立即扣库存），复核人确认后转正式领用。
 */
export function AdhesiveRequestPanel({ procedureId, specimenId, specimenNo }: AdhesiveRequestPanelProps) {
  const lots = useSupplyStore((s) => s.items);
  const requests = useAdhesiveStore((s) => s.items);
  const submitReq = useAdhesiveStore((s) => s.submit);
  const amendReq = useAdhesiveStore((s) => s.amend);
  const cancelReq = useAdhesiveStore((s) => s.cancel);
  const confirmReq = useAdhesiveStore((s) => s.confirm);
  const current = useAuthStore((s) => s.current);

  const [lotId, setLotId] = useState('');
  const [qty, setQty] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState(1);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  /** 受控胶种批次（全部胶种均受控），附占用口径 */
  const adhesiveLots = useMemo(
    () =>
      lots
        .filter((l) => l.kind === '胶种')
        .map((l) => ({ lot: l, alloc: getLotAllocation(l, requests) })),
    [lots, requests],
  );

  const mine = useMemo(
    () =>
      requests
        .filter((r) => r.procedureId === procedureId)
        .sort((a, b) => a.submittedAt - b.submittedAt || a.id.localeCompare(b.id)),
    [requests, procedureId],
  );

  const selected = adhesiveLots.find((x) => x.lot.id === lotId);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      setEditingId(null);
    } catch (e) {
      setError(e instanceof AdhesiveFlowError ? e.message : '操作失败，请重试');
    }
  };

  const submit = () => {
    if (!lotId || !selected) {
      setError('请先选择受控胶种批号');
      return;
    }
    void run(async () => {
      await submitReq({
        supplyLotId: lotId,
        procedureId,
        specimenId,
        specimenNo,
        qty,
        applicant: current.name,
      });
      setQty(1);
      setToast('用量申请已提交：先形成待确认占用，容量不足时自动排队');
    });
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50' }} data-testid="adhesive-panel">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }} flexWrap="wrap">
        <LockIcon fontSize="small" color="action" />
        <Typography variant="subtitle2" fontWeight={700}>
          受控胶种用量申请
        </Typography>
        <Chip size="small" variant="outlined" label="提交后不直接扣库，需复核人确认" />
      </Stack>

      {error ? <Alert severity="error" sx={{ mb: 1 }} data-testid="adhesive-error">{error}</Alert> : null}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        alignItems={{ sm: 'flex-start' }}
        sx={{ mb: 1 }}
      >
        <TextField
          select
          size="small"
          label="胶种批号"
          value={lotId}
          onChange={(e) => {
            setLotId(e.target.value);
            setError('');
          }}
          sx={{ minWidth: 260 }}
          helperText={
            selected
              ? `可用 ${selected.alloc.available} / 在库 ${selected.lot.qty} ${selected.lot.unit} · 待确认 ${selected.alloc.heldQty} · 排队 ${selected.alloc.waitingCount} 笔`
              : '仅胶种需走申请-复核流程'
          }
        >
          {adhesiveLots.length === 0 ? (
            <MenuItem value="" disabled>
              暂无胶种批次
            </MenuItem>
          ) : null}
          {adhesiveLots.map(({ lot, alloc }) => (
            <MenuItem key={lot.id} value={lot.id}>
              {lot.name} · {lot.lotNo}（可用 {alloc.available}/{lot.qty} {lot.unit}，排队 {alloc.waitingCount}）
            </MenuItem>
          ))}
        </TextField>
        <Box sx={{ width: 150 }}>
          <MeasureField
            label="申请用量"
            unit={selected?.lot.unit ?? '件'}
            min={0.1}
            max={selected?.lot.qty ?? 100000}
            step={0.5}
            value={qty}
            onChange={setQty}
            hint={selected ? `可用 ${selected.alloc.available} ${selected.lot.unit}` : '选批号后显示可用量'}
          />
        </Box>
        <Button
          variant="contained"
          size="medium"
          onClick={submit}
          disabled={!lotId || adhesiveLots.length === 0}
          sx={{ mt: 0.5 }}
        >
          提交申请
        </Button>
      </Stack>

      {mine.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          本工序暂无胶种用量申请记录。
        </Typography>
      ) : (
        <Divider sx={{ mb: 1 }} />
      )}
      <Stack spacing={1}>
        {mine.map((req) => {
          const rank = waitingRank(req, requests);
          const isReviewer = current.role === 'reviewer';
          return (
            <Paper
              key={req.id}
              variant="outlined"
              data-testid={`adhesive-req-${req.id}`}
              sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
            >
              {req.status === 'confirmed' ? (
                <CheckCircleIcon fontSize="small" color="success" />
              ) : req.status === 'waiting' ? (
                <HourglassEmptyIcon fontSize="small" color="info" />
              ) : (
                <LockIcon fontSize="small" color="warning" />
              )}
              <Box sx={{ minWidth: 180 }}>
                <Typography variant="body2" fontWeight={600}>
                  {req.supplyLotName} · {req.lotNo}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {req.qty} {req.unit} · {req.applicant} 提交于 {fmtTime(req.submittedAt)}
                  {req.confirmer ? ` · ${req.confirmer} 已确认` : ''}
                </Typography>
              </Box>
              <Chip size="small" color={STATUS_COLOR[req.status]} label={ADHESIVE_REQUEST_STATUS_LABEL[req.status]} />
              {rank !== undefined ? (
                <Chip
                  size="small"
                  variant="outlined"
                  color="info"
                  data-testid={`waiting-rank-${req.id}`}
                  label={`等待名次 第 ${rank} 位`}
                />
              ) : null}
              <Box sx={{ flex: 1 }} />
              {req.status === 'held' || req.status === 'waiting' ? (
                <>
                  {editingId === req.id ? (
                    <>
                      <Box sx={{ width: 130 }}>
                        <MeasureField
                          label="新用量"
                          unit={req.unit}
                          min={0.1}
                          max={100000}
                          step={0.5}
                          value={editQty}
                          onChange={setEditQty}
                        />
                      </Box>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => void run(() => amendReq(req.id, editQty))}
                      >
                        保存
                      </Button>
                      <Button size="small" onClick={() => setEditingId(null)}>
                        取消
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="small"
                      onClick={() => {
                        setEditingId(req.id);
                        setEditQty(req.qty);
                        setError('');
                      }}
                    >
                      改用量
                    </Button>
                  )}
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() =>
                      void run(async () => {
                        await cancelReq(req.id);
                        setToast('申请已撤销，占用已释放');
                      })
                    }
                  >
                    撤销
                  </Button>
                  <Button
                    size="small"
                    variant={isReviewer ? 'contained' : 'outlined'}
                    color="success"
                    disabled={req.status !== 'held'}
                    data-testid={`confirm-adhesive-${req.id}`}
                    onClick={() =>
                      void run(async () => {
                        await confirmReq(req.id, current.name, current.role);
                        setToast('已确认：库存已扣减并写入材料台账');
                      })
                    }
                  >
                    复核确认
                  </Button>
                </>
              ) : null}
            </Paper>
          );
        })}
      </Stack>

      {toast ? (
        <Alert
          severity="success"
          sx={{ mt: 1 }}
          onClose={() => setToast('')}
        >
          {toast}
        </Alert>
      ) : null}
    </Paper>
  );
}

export default AdhesiveRequestPanel;
