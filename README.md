# sologsb-1119 化石修复工序档案（gbfossilprep）

面向博物馆化石修复技师的工序留痕工作台：标本从入库、清修、加固到交付逐节点留痕，登记工具与胶种用量，并做修复前后对照。纯前端单页应用，数据全部保存在浏览器本地。

## Docker 一键启动（推荐）

```bash
cp .env.example .env
docker compose up -d --build
```

访问地址：**http://localhost:21819**

停止服务：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| UI | MUI（Material UI）v5 |
| 构建 | Vite 5 |
| 状态管理 | Zustand |
| 路由 | React Router v6（BrowserRouter） |
| 本地存储 | IndexedDB（Dexie 4），影像单独建表，含结构版本号与升级迁移 |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc 类型检查 + vite 构建
```

> 生产环境由 nginx 托管 `dist`，`nginx.conf` 已启用 `try_files $uri $uri/ /index.html;` 与 gzip。

## 目录结构

```
sologsb-1119/
├── docker-compose.yml
├── .env.example
├── .env
└── frontend/
    ├── Dockerfile              # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── main.tsx
        ├── router/index.tsx
        ├── types/{specimen,procedure,supply,photo}.ts
        ├── stores/{specimen,procedure,supply}Store.ts
        ├── components/common/{ProcedureTimeline,BeforeAfterSlider,SpecimenCard,MeasureField}.tsx
        ├── hooks/{useSpecimenSearch,usePrepProgress}.ts
        ├── pages/{SpecimenList,SpecimenDetail,ProcedureForm,SupplyList,CompareView}.tsx
        └── utils/{db,unitConvert,id}.ts
```

## 页面与路由

| 路由 | 页面 | 消费模型 |
| --- | --- | --- |
| `/specimens` | 标本台账：按号/分类/产地/状态筛选，状态分栏 | Specimen |
| `/specimens/:id` | 标本详情 + 工序时间线 + 影像留痕 | Specimen、PrepProcedure、PrepPhoto |
| `/procedures/new` | 新建工序节点：按类型动态出工具/磨料/胶种字段，序号跳号报错 | PrepProcedure、Specimen |
| `/supplies` | 工具材料台账：按种类分组、批号追溯、低量高亮、领用登记 | SupplyLot |
| `/compare/:specimenId` | 前后对照滑块联看 + 导出对照说明文本 | PrepPhoto、PrepProcedure |

`/` 重定向到 `/specimens`，未匹配路由同样兜底到 `/specimens`。

## 数据存储说明

- 数据库名 `gbfossilprep`，当前结构版本 **v3**（`localStorage['gbfossilprep:db-version']` 记录）。
- 五张表：`specimens`（标本）、`procedures`（修复工序）、`supplies`（工具材料批次 + 领用记录）、`adhesives`（受控胶种用量申请/占用/排队）、`photos`（修复影像 dataUrl 独立表）。
- v1 → v2 迁移：为老数据补齐 `state`、`tools`、`photoBeforeIds/AfterIds`、`issues`、`lowThreshold` 字段并新增索引。
- v2 → v3 迁移：新增 `adhesives` 表（仅建表，老数据无需改写；没有申请记录的旧工序照常打开）。
- 容器无状态、不挂载命名卷；换浏览器或清空站点数据即回到初始示范数据。
- 首次打开会灌入 2 件示范标本、3 个工序节点、4 个材料批次、2 笔胶种占用/排队示范与 2 张留痕影像，便于直接查看。

## 受控胶种：申请-占用-复核流程

胶种（`kind === '胶种'`）不能再由技师在材料台账直接领用，全部走工序内申请：

1. **提交申请**：技师在工序节点展开区选择胶种批号、填写用量后提交。系统**不立即扣库存**，先生成一笔申请：容量够时为「待确认占用」（held），不够时为「排队等待」（waiting）。
2. **FIFO 排队**：同一批次严格按 `submittedAt`（提交时间）排序占用，先提交优先；遇到队首装不下，其后申请即使零头够用也不越过。修改用量（含改大）**不刷新提交时间**，后提交或后来改大的用量不能挤掉前面申请。
3. **复核确认**：仅「复核人」角色（顶栏可切换当前身份）可确认 held 申请；确认时才扣减在库、写入批次领用台账。技师点击确认会被拒绝，申请保持原状。waiting 申请不能确认。
4. **释放与补位**：技师可撤销未确认申请；工序回退或移除时，该工序下所有 held/waiting 申请自动释放。每次释放/扣减后同批次全量重排，队首 waiting 自动补位。
5. **口径一致**：材料台账与工序面板的在库、待确认占用、可用量（在库 − 待确认占用）、等待笔数/名次均由 `utils/allocation.ts` 同一组纯函数计算。

## 功能要点

- **工序序号不跳号**：新建节点时若序号大于「当前最大序号 + 1」直接报错并给出建议序号。
- **工序回退**：已完成节点可回退，回退后计入待办与回退计数。
- **低量高亮**：在库（胶种按可用量）≤ 低量阈值的批次整行高亮并标注「低量」，剩余保质期为负时红色标注。
- **批号追溯**：按批号片段检索，行内直接展示该批次的领用明细。
- **受控胶种**：技师按批号在工序内提交用量申请 → 待确认占用/排队 → 复核人确认后才扣库；同批次按提交时间 FIFO，工序回退/移除自动释放补位（详见上节）。
- **前后对照**：滑块拖动联看修复前后影像，支持缩放与标注泡点，可导出/复制对照说明文本。
