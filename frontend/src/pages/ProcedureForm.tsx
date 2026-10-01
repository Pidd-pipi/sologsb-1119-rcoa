import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import { useSpecimenStore } from '../stores/specimenStore';
import { useProcedureStore } from '../stores/procedureStore';
import { useSupplyStore } from '../stores/supplyStore';
import { usePrepProgress } from '../hooks/usePrepProgress';
import { ProcedureTimeline } from '../components/common/ProcedureTimeline';
import { MeasureField } from '../components/common/MeasureField';
import { STEP_FIELD_MAP, STEP_TYPES, type StepType } from '../types/procedure';
import { isLowStock, type SupplyLot } from '../types/supply';
import { deriveLotAvailability } from '../utils/supplyRequests';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import { makeSketchDataUrl, type PrepPhoto } from '../types/photo';

/** /procedures/new 新建工序节点：选类型动态出字段，序号跳号报错 */
export default function ProcedureForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const specimens = useSpecimenStore((s) => s.items);
  const addProcedure = useProcedureStore((s) => s.add);
  const finish = useProcedureStore((s) => s.finish);
  const rollback = useProcedureStore((s) => s.rollback);
  const supplyLots = useSupplyStore((s) => s.items);
  const supplyRequests = useSupplyStore((s) => s.requests);
  const submitRequest = useSupplyStore((s) => s.submitRequest);

  const [specimenId, setSpecimenId] = useState(params.get('specimenId') ?? specimens[0]?.id ?? '');
  const [stepType, setStepType] = useState<StepType>('清修');
  const [nodeName, setNodeName] = useState('');
  const [seq, setSeq] = useState(1);
  const [tools, setTools] = useState<string[]>([]);
  const [abrasive, setAbrasive] = useState('');
  const [adhesive, setAdhesive] = useState('');
  const [adhesiveConc, setAdhesiveConc] = useState(5);
  const [requestLotId, setRequestLotId] = useState('');
  const [requestQty, setRequestQty] = useState(1);
  const [durationMin, setDurationMin] = useState(60);
  const [tempC, setTempC] = useState(22);
  const [rh, setRh] = useState(50);
  const [operator, setOperator] = useState('');
  const [withPhotos, setWithPhotos] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const progress = usePrepProgress(specimenId || undefined);
  const fieldMap = STEP_FIELD_MAP[stepType];
  const nextSeq = progress.list.length === 0 ? 1 : Math.max(...progress.list.map((it) => it.seq)) + 1;

  const specimen = useMemo(() => specimens.find((it) => it.id === specimenId), [specimens, specimenId]);

  /** 当前胶种可选批次（同名受控胶种），附可用量 / 待确认量 */
  const adhesiveLots = useMemo<SupplyLot[]>(() => {
    if (!adhesive) return [];
    return supplyLots.filter((l) => l.kind === '胶种' && l.name === adhesive);
  }, [supplyLots, adhesive]);

  const selectedLot = useMemo(
    () => adhesiveLots.find((l) => l.id === requestLotId) ?? supplyLots.find((l) => l.id === requestLotId),
    [adhesiveLots, supplyLots, requestLotId],
  );
  const selectedAvail = selectedLot ? deriveLotAvailability(selectedLot, supplyRequests) : undefined;

  const submit = async () => {
    if (!specimenId) {
      setError('请先选择标本');
      return;
    }
    if (!nodeName.trim()) {
      setError('节点名称必填');
      return;
    }
    if (!operator.trim()) {
      setError('责任人必填');
      return;
    }
    const used = progress.list.map((it) => it.seq);
    if (used.includes(seq)) {
      setError(`序号 ${seq} 已被占用，请改用 ${nextSeq}`);
      return;
    }
    if (seq > nextSeq) {
      setError(`序号跳号：当前最大序号为 ${Math.max(0, nextSeq - 1)}，新节点必须用 ${nextSeq}`);
      return;
    }
    if (!Number.isFinite(adhesiveConc) || adhesiveConc < 0 || adhesiveConc > 100) {
      setError('胶液浓度需在 0 ~ 100 % 之间');
      return;
    }
    const adhesiveChosen = fieldMap.adhesives.length > 0 ? adhesive : '';
    if (adhesiveChosen && requestLotId) {
      if (!Number.isFinite(requestQty) || requestQty <= 0) {
        setError('胶种用量必须大于 0');
        return;
      }
    }

    const record = await addProcedure({
      specimenId,
      stepType,
      nodeName: nodeName.trim(),
      seq,
      tools,
      abrasive,
      adhesive: adhesiveChosen,
      adhesiveConc: fieldMap.needConc ? adhesiveConc : 0,
      durationMin,
      tempC,
      rh,
      photoBeforeIds: [],
      photoAfterIds: [],
      operator: operator.trim(),
      startedAt: Date.now(),
      state: 'pending',
    });

    // 受控胶种：按批号提交用量申请，形成待确认占用（库存不立即扣）
    let queueNote = '';
    if (adhesiveChosen && requestLotId && specimen) {
      try {
        await submitRequest({
          lotId: requestLotId,
          procedureId: record.id,
          specimenId,
          specimenNo: specimen.specimenNo,
          qty: requestQty,
          requestedBy: operator.trim(),
        });
        const lot = supplyLots.find((l) => l.id === requestLotId);
        if (lot) {
          const avail = deriveLotAvailability(lot, useSupplyStore.getState().requests);
          const view = avail.views.find((v) => v.request.procedureId === record.id);
          queueNote = view?.occupy
            ? `；已形成待确认占用（可用 ${avail.availableQty} ${lot.unit}）`
            : `；批次容量不足，已排队，等待名次 ${view?.queuePos ?? '-'}`;
        }
      } catch (e) {
        setError(`用量申请失败：${(e as Error).message}`);
      }
    }

    if (withPhotos && specimen) {
      const before: PrepPhoto = {
        id: newId('pho'),
        specimenId,
        procedureId: record.id,
        stage: 'before',
        caption: `${nodeName.trim()} · 修复前（${specimen.specimenNo}）`,
        dataUrl: makeSketchDataUrl(`修复前 · ${specimen.specimenNo}`, '#6b5844'),
        capturedAt: Date.now(),
      };
      const after: PrepPhoto = {
        id: newId('pho'),
        specimenId,
        procedureId: record.id,
        stage: 'after',
        caption: `${nodeName.trim()} · 修复后（${specimen.specimenNo}）`,
        dataUrl: makeSketchDataUrl(`修复后 · ${specimen.specimenNo}`, '#3f5a4a'),
        capturedAt: Date.now() + 1,
      };
      await db.photos.bulkPut([before, after]);
    }

    setError('');
    setToast(`已追加工序节点 #${seq} ${stepType} · ${record.nodeName}${queueNote}`);
    setNodeName('');
    setTools([]);
    setAdhesive('');
    setRequestLotId('');
    setRequestQty(1);
    setSeq(nextSeq + 1);
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="h5" fontWeight={700}>
          新建工序节点
        </Typography>
        <Chip size="small" variant="outlined" label={`建议序号 ${nextSeq}`} />
        <Chip size="small" variant="outlined" label={`现有节点 ${progress.total} 个`} />
        <Box sx={{ flex: 1 }} />
        <Button onClick={() => navigate(`/specimens/${specimenId}`)} disabled={!specimenId}>
          查看标本详情
        </Button>
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 420px' }, gap: 2 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            {error ? <Alert severity="error" data-testid="procedure-error">{error}</Alert> : null}
            <TextField
              select
              size="small"
              label="标本"
              value={specimenId}
              onChange={(e) => {
                setSpecimenId(e.target.value);
                setSeq(1);
              }}
            >
              {specimens.map((it) => (
                <MenuItem key={it.id} value={it.id}>
                  {it.specimenNo} · {it.taxon}
                </MenuItem>
              ))}
            </TextField>

            <Stack direction="row" spacing={1.5}>
              <TextField
                select
                size="small"
                fullWidth
                label="工序类型"
                value={stepType}
                onChange={(e) => {
                  const next = e.target.value as StepType;
                  setStepType(next);
                  setTools([]);
                  setAbrasive('');
                  setAdhesive('');
                  setRequestLotId('');
                }}
              >
                {STEP_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                fullWidth
                label="节点名称"
                required
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
              />
              <Box sx={{ width: 120 }}>
                <MeasureField
                  label="序号"
                  unit="seq"
                  min={1}
                  max={999}
                  step={1}
                  value={seq}
                  onChange={setSeq}
                  hint={`不得跳号，建议 ${nextSeq}`}
                />
              </Box>
            </Stack>

            {fieldMap.tools.length > 0 ? (
              <TextField
                select
                size="small"
                label="使用工具"
                SelectProps={{ multiple: true }}
                value={tools}
                onChange={(e) => {
                  const v = e.target.value;
                  setTools(typeof v === 'string' ? v.split(',') : v);
                }}
                helperText="气动笔 / 剔针 / 超声波 等，可多选"
              >
                {fieldMap.tools.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <Alert severity="info">该工序类型无需工具清单</Alert>
            )}

            {fieldMap.abrasives.length > 0 ? (
              <TextField
                select
                size="small"
                label="磨料目数"
                value={abrasive}
                onChange={(e) => setAbrasive(e.target.value)}
              >
                <MenuItem value="">不适用</MenuItem>
                {fieldMap.abrasives.map((a) => (
                  <MenuItem key={a} value={a}>
                    {a}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}

            {fieldMap.adhesives.length > 0 ? (
              <Stack direction="row" spacing={1.5}>
                <TextField
                  select
                  size="small"
                  fullWidth
                  label="胶种"
                  value={adhesive}
                  onChange={(e) => {
                    setAdhesive(e.target.value);
                    setRequestLotId('');
                  }}
                >
                  <MenuItem value="">未选定</MenuItem>
                  {fieldMap.adhesives.map((a) => (
                    <MenuItem key={a} value={a}>
                      {a}
                    </MenuItem>
                  ))}
                </TextField>
                {fieldMap.needConc ? (
                  <Box sx={{ flex: 1 }}>
                    <MeasureField
                      label="胶液浓度"
                      unit="%"
                      min={0}
                      max={100}
                      step={0.5}
                      value={adhesiveConc}
                      onChange={setAdhesiveConc}
                    />
                  </Box>
                ) : null}
              </Stack>
            ) : null}

            {fieldMap.adhesives.length > 0 && adhesive ? (
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <TextField
                  select
                  size="small"
                  fullWidth
                  label="受控胶种批号（按批号提交用量申请）"
                  value={requestLotId}
                  onChange={(e) => setRequestLotId(e.target.value)}
                  helperText={
                    selectedLot && selectedAvail
                      ? `可用 ${selectedAvail.availableQty} ${selectedLot.unit} · 待确认 ${selectedAvail.heldQty} ${selectedLot.unit}${
                          isLowStock(selectedLot) ? ' · 该批次低量' : ''
                        }`
                      : '选择批次后按先提交先占用规则排队，库存不立即扣减'
                  }
                >
                  <MenuItem value="">不领用胶种</MenuItem>
                  {adhesiveLots.map((l) => {
                    const avail = deriveLotAvailability(l, supplyRequests);
                    return (
                      <MenuItem key={l.id} value={l.id}>
                        批号 {l.lotNo} · 可用 {avail.availableQty} {l.unit}（待确认 {avail.heldQty}）
                      </MenuItem>
                    );
                  })}
                </TextField>
                {requestLotId ? (
                  <Box sx={{ flex: 1 }}>
                    <MeasureField
                      label="申请用量"
                      unit={selectedLot?.unit ?? ''}
                      min={1}
                      max={100000}
                      step={1}
                      value={requestQty}
                      onChange={setRequestQty}
                      hint={
                        selectedAvail && requestQty > selectedAvail.availableQty
                          ? `超出可用量，提交后排队（等待名次 ${selectedAvail.activeCount + 1}）`
                          : '提交后形成待确认占用，复核确认才扣库存'
                      }
                    />
                  </Box>
                ) : null}
              </Stack>
            ) : null}

            <Stack direction="row" spacing={1.5}>
              <Box sx={{ flex: 1 }}>
                <MeasureField
                  label="耗时"
                  unit="min"
                  min={1}
                  max={1440}
                  step={1}
                  value={durationMin}
                  onChange={setDurationMin}
                />
              </Box>
              <Box sx={{ flex: 1 }}>
                <MeasureField label="环境温度" unit="℃" min={-10} max={60} step={0.5} value={tempC} onChange={setTempC} />
              </Box>
              <Box sx={{ flex: 1 }}>
                <MeasureField label="相对湿度" unit="%" min={0} max={100} step={1} value={rh} onChange={setRh} />
              </Box>
            </Stack>

            <TextField
              size="small"
              label="责任人"
              required
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
            />

            <FormControlLabel
              control={<Checkbox checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />}
              label="同时挂接修复前 / 修复后留痕影像（本地生成）"
            />

            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={submit}>
                保存节点
              </Button>
              <Button onClick={() => navigate('/procedures/new')}>清空重填</Button>
            </Stack>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>
            该标本现有工序
          </Typography>
          {specimen ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {specimen.specimenNo} · 完成度 {progress.percent}% · 待办{' '}
              {progress.current ? `#${progress.current.seq} ${progress.current.nodeName}` : '无'}
            </Typography>
          ) : null}
          <ProcedureTimeline
            items={progress.list}
            onFinish={async (pid) => {
              await finish(pid);
              setToast('节点已完成');
            }}
            onRollback={async (pid) => {
              await rollback(pid);
              setToast('节点已回退');
            }}
          />
        </Paper>
      </Box>

      <Snackbar open={!!toast} autoHideDuration={2600} onClose={() => setToast('')} message={toast} />
    </Stack>
  );
}
