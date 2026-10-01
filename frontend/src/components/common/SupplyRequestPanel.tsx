import { useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Paper from '@mui/material/Paper';
import Alert from '@mui/material/Alert';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import { useSupplyStore } from '../../stores/supplyStore';
import { useRoleStore } from '../../stores/roleStore';
import { deriveLotAvailability, requestsOfProcedure } from '../../utils/supplyRequests';
import type { SupplyRequest } from '../../types/supply';

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusChip(req: SupplyRequest) {
  switch (req.status) {
    case 'pending':
      return <Chip size="small" color="warning" variant="outlined" label="待确认占用" />;
    case 'confirmed':
      return <Chip size="small" color="success" label="已确认 · 正式领用" />;
    case 'rejected':
      return <Chip size="small" color="error" variant="outlined" label="已拒绝" />;
    case 'released':
      return <Chip size="small" variant="outlined" label="已释放占用" />;
  }
}

export interface SupplyRequestPanelProps {
  procedureId: string;
}

/**
 * 工序页内的受控胶种用量申请面板：
 * 显示该工序各申请的待确认占用 / 等待名次 / 可用量，
 * 技师可改用量（保留顺位），复核员可确认 / 拒绝。
 * 旧工序没有申请记录时不渲染任何内容，保证正常打开。
 */
export function SupplyRequestPanel({ procedureId }: SupplyRequestPanelProps) {
  const lots = useSupplyStore((s) => s.items);
  const requests = useSupplyStore((s) => s.requests);
  const confirmRequest = useSupplyStore((s) => s.confirmRequest);
  const rejectRequest = useSupplyStore((s) => s.rejectRequest);
  const updateRequestQty = useSupplyStore((s) => s.updateRequestQty);
  const role = useRoleStore((s) => s.role);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [qtyDraft, setQtyDraft] = useState(1);
  const [error, setError] = useState('');

  const mine = requestsOfProcedure(procedureId, requests);
  if (mine.length === 0) return null;

  const startEdit = (req: SupplyRequest) => {
    setEditingId(req.id);
    setQtyDraft(req.qty);
    setError('');
  };

  const saveEdit = async (id: string) => {
    if (!Number.isFinite(qtyDraft) || qtyDraft <= 0) {
      setError('申请用量必须大于 0');
      return;
    }
    try {
      await updateRequestQty(id, qtyDraft);
      setEditingId(null);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doConfirm = async (id: string) => {
    setError('');
    try {
      await confirmRequest(id, role);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doReject = async (id: string) => {
    setError('');
    await rejectRequest(id, '复核拒绝');
  };

  return (
    <Box sx={{ mt: 1 }} data-testid="supply-request-panel">
      {error ? (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>
          {error}
        </Alert>
      ) : null}
      <Stack spacing={0.75}>
        {mine.map((req) => {
          const lot = lots.find((l) => l.id === req.lotId);
          const avail = lot ? deriveLotAvailability(lot, requests) : undefined;
          const view = avail?.views.find((v) => v.request.id === req.id);
          const isPending = req.status === 'pending';
          return (
            <Paper
              key={req.id}
              variant="outlined"
              sx={{ p: 1, bgcolor: isPending ? 'warning.50' : 'background.paper' }}
            >
              <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                <Typography variant="body2" fontWeight={600}>
                  {lot ? lot.name : '批次已删除'}
                  {lot ? `（批号 ${lot.lotNo}）` : ''}
                </Typography>
                {statusChip(req)}
                {isPending && view ? (
                  view.occupy ? (
                    <Chip size="small" color="warning" variant="outlined" label={`占用中 · 顺位 ${view.queuePos}`} />
                  ) : (
                    <Chip size="small" color="info" variant="outlined" label={`排队中 · 等待名次 ${view.queuePos}`} />
                  )
                ) : null}
                <Box sx={{ flex: 1 }} />
                {editingId === req.id ? (
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <TextField
                      size="small"
                      type="number"
                      value={qtyDraft}
                      onChange={(e) => setQtyDraft(Number(e.target.value))}
                      inputProps={{ min: 1, step: 1 }}
                      sx={{ width: 90 }}
                    />
                    <Typography variant="caption">{req.unit}</Typography>
                    <IconButton size="small" color="primary" onClick={() => saveEdit(req.id)}>
                      <CheckIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => setEditingId(null)}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ) : (
                  <Typography variant="body2">
                    申请 <b>{req.qty}</b> {req.unit}
                  </Typography>
                )}
                {isPending && editingId !== req.id ? (
                  <IconButton size="small" title="改用量（保留排队顺位）" onClick={() => startEdit(req)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                ) : null}
                {isPending ? (
                  <>
                    <Button size="small" variant="contained" color="success" onClick={() => doConfirm(req.id)}>
                      确认领用
                    </Button>
                    <Button size="small" color="error" onClick={() => doReject(req.id)}>
                      拒绝
                    </Button>
                  </>
                ) : null}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                申请人 {req.requestedBy} · 提交于 {fmtTime(req.submittedAt)}
                {req.confirmedAt ? ` · 已于 ${fmtTime(req.confirmedAt)} 正式领用` : ''}
                {req.rejectReason ? ` · 拒绝原因：${req.rejectReason}` : ''}
                {req.status === 'released' ? ` · ${fmtTime(req.releasedAt)} 释放` : ''}
                {isPending && lot && avail
                  ? ` · 批次可用 ${avail.availableQty} ${lot.unit} / 待确认 ${avail.heldQty} ${lot.unit}`
                  : ''}
              </Typography>
            </Paper>
          );
        })}
      </Stack>
    </Box>
  );
}

export default SupplyRequestPanel;
