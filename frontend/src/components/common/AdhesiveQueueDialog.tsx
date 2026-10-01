import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import LockIcon from '@mui/icons-material/Lock';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useSupplyStore } from '../../stores/supplyStore';
import { useAdhesiveStore, AdhesiveFlowError } from '../../stores/adhesiveStore';
import { useAuthStore } from '../../stores/authStore';
import { getLotAllocation, waitingRank } from '../../utils/allocation';
import { ADHESIVE_REQUEST_STATUS_LABEL, type AdhesiveRequest } from '../../types/adhesive';
import type { SupplyLot } from '../../types/supply';

export interface AdhesiveQueueDialogProps {
  lot: SupplyLot | null;
  onClose: () => void;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusIcon(req: AdhesiveRequest) {
  if (req.status === 'confirmed') return <CheckCircleIcon fontSize="small" color="success" />;
  if (req.status === 'waiting') return <HourglassEmptyIcon fontSize="small" color="info" />;
  if (req.status === 'held') return <LockIcon fontSize="small" color="warning" />;
  return null;
}

/** 受控胶种批次的占用/排队队列与复核入口（材料台账内） */
export function AdhesiveQueueDialog({ lot, onClose }: AdhesiveQueueDialogProps) {
  const lots = useSupplyStore((s) => s.items);
  const requests = useAdhesiveStore((s) => s.items);
  const confirmReq = useAdhesiveStore((s) => s.confirm);
  const current = useAuthStore((s) => s.current);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  if (!lot) return null;
  const freshLot = lots.find((l) => l.id === lot.id) ?? lot;
  const alloc = getLotAllocation(freshLot, requests);
  const rows = requests
    .filter((r) => r.supplyLotId === lot.id && r.status !== 'released')
    .sort((a, b) => {
      // held 按提交时间在前，waiting 按提交时间，confirmed 最后
      const order = { held: 0, waiting: 1, confirmed: 2, released: 3 } as const;
      return order[a.status] - order[b.status] || a.submittedAt - b.submittedAt || a.id.localeCompare(b.id);
    });

  const doConfirm = async (id: string) => {
    setError('');
    try {
      await confirmReq(id, current.name, current.role);
      setToast('已确认：库存已扣减并写入台账，后续排队已自动补位');
    } catch (e) {
      setError(e instanceof AdhesiveFlowError ? e.message : '确认失败，请重试');
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        受控胶种占用队列 · {freshLot.name}（{freshLot.lotNo}）
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          {error ? <Alert severity="error" data-testid="queue-error">{error}</Alert> : null}
          {toast ? (
            <Alert severity="success" onClose={() => setToast('')}>
              {toast}
            </Alert>
          ) : null}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Chip size="small" label={`在库 ${alloc.qty} ${freshLot.unit}`} />
            <Chip size="small" color="warning" label={`待确认占用 ${alloc.heldQty} ${freshLot.unit}`} />
            <Chip size="small" color="success" variant="outlined" label={`可用 ${alloc.available} ${freshLot.unit}`} />
            <Chip
              size="small"
              color="info"
              variant="outlined"
              label={`排队等待 ${alloc.waitingCount} 笔 / ${alloc.waitingQty} ${freshLot.unit}`}
            />
          </Box>
          <Typography variant="caption" color="text.secondary">
            同批次按提交时间先到先占；改大用量不改变提交先后。当前身份：{current.name}（{current.role === 'reviewer' ? '复核人' : '技师'}）
            {current.role !== 'reviewer' ? '，无复核权限，确认操作将被拒绝。' : ''}
          </Typography>
          <Divider />
          {rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              该批次暂无占用与排队记录。
            </Typography>
          ) : (
            <List dense disablePadding data-testid="adhesive-queue">
              {rows.map((req) => {
                const rank = waitingRank(req, requests);
                return (
                  <ListItem
                    key={req.id}
                    divider
                    data-testid={`queue-row-${req.id}`}
                    secondaryAction={
                      req.status === 'held' ? (
                        <Button
                          size="small"
                          variant="contained"
                          color="success"
                          onClick={() => void doConfirm(req.id)}
                        >
                          复核确认
                        </Button>
                      ) : null
                    }
                    sx={{ alignItems: 'flex-start' }}
                  >
                    <Stack direction="row" spacing={1} sx={{ minWidth: 0 }}>
                      <Box sx={{ pt: 0.3 }}>{statusIcon(req)}</Box>
                      <Box>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                          <Chip
                            size="small"
                            color={
                              req.status === 'held'
                                ? 'warning'
                                : req.status === 'waiting'
                                  ? 'info'
                                  : 'success'
                            }
                            label={ADHESIVE_REQUEST_STATUS_LABEL[req.status]}
                          />
                          {rank !== undefined ? (
                            <Chip size="small" variant="outlined" color="info" label={`等待名次 第 ${rank} 位`} />
                          ) : null}
                          <Typography variant="body2" fontWeight={600}>
                            {req.qty} {req.unit}
                          </Typography>
                        </Stack>
                        <Typography variant="caption" display="block" color="text.secondary">
                          {req.applicant} · 用于 {req.specimenNo} · {fmtTime(req.submittedAt)} 提交
                        </Typography>
                        {req.confirmer ? (
                          <Typography variant="caption" display="block" color="text.secondary">
                            {req.confirmer} 于 {fmtTime(req.confirmedAt ?? 0)} 确认领用
                          </Typography>
                        ) : null}
                      </Box>
                    </Stack>
                  </ListItem>
                );
              })}
            </List>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

export default AdhesiveQueueDialog;
