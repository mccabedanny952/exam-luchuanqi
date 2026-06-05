# 鲸天系统 · 转运文件处理台

本项目基于 Next.js App Router + TypeScript，实现考试要求中的多格式转运文件接入：接入 Excel / Word / PDF 后，由用户手动选择字段规则，或通过 LLM 起草可编辑规则，人工确认后再生成明细、预览、校验、提交入库。

## 核心能力

- UI 调整为鲸天系统风格：青绿色主色 `#0fc6c2`、顶部栏、深色侧栏、紧凑内容区、表格化工作台。
- 支持 Excel `.xlsx/.xls`、Word `.docx`、PDF 文件入口。
- 规则引擎覆盖普通表格、尾部信息提取、多 Sheet 合并、卡片式、矩阵转置、文本/PDF 解析。
- AI 只起草“字段规则”，不绕过用户确认直接导入数据；规则含 `aiNotes` 标注推测项。
- 导入后进入类 Excel 预览表，支持固定表头、横向滚动、单元格编辑、新增/删除行、导出 Excel。
- 校验规则按新试卷字段：SKU 编码/名称/数量必填；收货门店或“收件人姓名+电话+地址”二选一；电话、数量、同一外部订单号下重复 SKU 实时校验；同一外部订单号允许对应多个不同 SKU。
- 1000+ 行预览使用虚拟渲染，避免大列表卡顿。
- 提交成功后写入 Prisma / PostgreSQL，入库记录支持关键词和时间筛选分页。

## 环境变量

本地 `.env` 或 Vercel 环境变量需配置：

```env
DATABASE_URL=your_neon_or_postgres_url
LLM_BASE_URL=https://988665.xyz/v1
LLM_API_KEY=your_llm_api_key
LLM_MODEL=gpt-5.5
```

代码通过 `src/lib/llm.ts` 读取环境变量，不在业务代码中硬编码 base url、api key 或 model。

## 启动

```bash
npm install
npx prisma generate
npm run dev
```

本地访问 [http://localhost:3000](http://localhost:3000)。如果 3000 被占用，可使用：

```bash
npm run dev -- -p 3001
```

## 数据库

Prisma schema 已升级为新试卷字段，并保留 V1 旧列/旧表为兼容结构。部署前需要在目标数据库同步 schema：

```bash
npx prisma db push
```

如果远程数据库提示 schema engine 或权限问题，请在 Neon / Vercel Marketplace 数据库控制台确认连接串权限后再同步。

## API

- `GET /api/mappings`：读取已保存字段规则列表。
- `POST /api/mappings`：保存当前确认后的字段规则。
- `DELETE /api/mappings?id=...`：删除字段规则。
- `POST /api/rules/generate`：调用 LLM 根据文件结构生成推荐规则。
- `POST /api/files/extract`：抽取 Word / PDF 文本结构。
- `POST /api/rules/execute`：按确认后的文本规则处理 Word / PDF。
- `GET /api/orders`：分页筛选入库记录。
- `POST /api/orders`：批量提交核对后的明细。
- `POST /api/orders/check-duplicates`：检查外部订单号 + SKU 编码明细是否已存在。

## 验证

```bash
npm run lint
npm run build
npx prisma validate
```
