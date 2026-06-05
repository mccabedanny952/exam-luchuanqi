import * as XLSX from "xlsx";

export type SystemFieldKey =
  | "externalCode"
  | "storeName"
  | "receiverName"
  | "receiverPhone"
  | "receiverAddress"
  | "skuCode"
  | "skuName"
  | "skuQuantity"
  | "skuSpec"
  | "remark";

export type RuleMode = "column" | "card" | "matrix" | "text";
export type SheetMode = "first" | "all";

export interface ParsedRow {
  _originalRowIndex: number;
  _sheetName?: string;
  _source?: string;
  [key: string]: string | number | null | undefined;
}

export interface ParseResult {
  headers: string[];
  data: ParsedRow[];
  fingerprint: string;
  summary: FileStructureSummary;
}

export interface SystemFieldDefinition {
  key: SystemFieldKey;
  label: string;
  required: boolean;
  group?: "receiver";
  numeric?: boolean;
}

export interface ValidationIssue {
  rowIndex: number;
  fieldKey: SystemFieldKey;
  msg: string;
}

export interface FooterExtractor {
  label: string;
  field: SystemFieldKey;
  valueOffset?: number;
  pattern?: string;
}

export interface MatrixRule {
  dynamicColumnStart?: number;
  rowFieldMap?: Partial<Record<SystemFieldKey, string>>;
  columnHeaderField?: SystemFieldKey;
  quantityField?: SystemFieldKey;
}

export interface TextRule {
  recordSeparator?: string;
  linePattern?: string;
  keyValueAliases?: Partial<Record<SystemFieldKey, string[]>>;
}

export interface ParsingRule {
  id?: string;
  name: string;
  mode: RuleMode;
  sheetMode: SheetMode;
  mapping: MappingState;
  headerRowIndex?: number;
  footerExtractors?: FooterExtractor[];
  defaults?: Partial<Record<SystemFieldKey, string>>;
  stopKeywords?: string[];
  matrix?: MatrixRule;
  text?: TextRule;
  aiNotes?: string[];
  confidence?: number;
}

export interface SheetSummary {
  name: string;
  rowCount: number;
  columnCount: number;
  sampleRows: string[][];
}

export interface FileStructureSummary {
  fileName: string;
  fileType: string;
  sheets: SheetSummary[];
  textPreview?: string;
}

export type MappingState = Partial<Record<SystemFieldKey, string>>;

type WorkbookRows = Record<string, unknown[][]>;

export const SYSTEM_FIELDS: SystemFieldDefinition[] = [
  { key: "externalCode", label: "外部编码", required: false },
  { key: "storeName", label: "收货门店", required: false, group: "receiver" },
  { key: "receiverName", label: "收件人姓名", required: false, group: "receiver" },
  { key: "receiverPhone", label: "收件人电话", required: false, group: "receiver" },
  { key: "receiverAddress", label: "收件人地址", required: false, group: "receiver" },
  { key: "skuCode", label: "SKU物品编码", required: true },
  { key: "skuName", label: "SKU物品名称", required: true },
  { key: "skuQuantity", label: "SKU发货数量", required: true, numeric: true },
  { key: "skuSpec", label: "SKU规格型号", required: false },
  { key: "remark", label: "备注", required: false },
];

const SYSTEM_HEADER_BY_KEY = SYSTEM_FIELDS.reduce<Record<SystemFieldKey, string>>((acc, field) => {
  acc[field.key] = field.label;
  return acc;
}, {} as Record<SystemFieldKey, string>);

const HEADER_KEYWORDS: Record<SystemFieldKey, string[]> = {
  externalCode: [
    "外部编码",
    "外部订单号",
    "客户单号",
    "配送单号",
    "配送汇总单号",
    "单据号",
    "订单号",
    "调拨单号",
    "ref code",
    "order no",
  ],
  storeName: ["收货门店", "收货机构", "调入门店", "门店", "机构", "店铺", "客户名称", "store"],
  receiverName: ["收件人姓名", "收件人", "收货人", "联系人", "签收人", "consignee", "receiver"],
  receiverPhone: ["收件人电话", "收货电话", "联系电话", "电话", "手机", "receiver phone", "tel"],
  receiverAddress: ["收件人地址", "收货地址", "地址", "完整地址", "receiver address"],
  skuCode: ["SKU物品编码", "物品编码", "商品编码", "外部商品编码", "SKU条码", "sku编码", "编码", "sku code"],
  skuName: ["SKU物品名称", "物品名称", "商品名称", "SKU名称", "品名", "名称", "sku name"],
  skuQuantity: [
    "SKU发货数量",
    "发货数量",
    "出库数量",
    "应发数量",
    "数量",
    "订货数量",
    "可用数量",
    "qty",
    "quantity",
  ],
  skuSpec: ["SKU规格型号", "规格型号", "规格", "型号", "规格描述", "spec"],
  remark: ["备注", "说明", "附言", "备注信息", "note", "remark"],
};

const TABLE_HEADER_HINTS = Object.values(HEADER_KEYWORDS).flat();
const STOP_KEYWORDS = ["合计", "总计", "小计", "制单人", "审核人", "签字", "打印时间"];

function normalizeCellValue(value: unknown): string | number | null | undefined {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return String(value);
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function compactRow(row: unknown[] = []): string[] {
  return row.map((cell) => normalizeText(cell));
}

function scoreHeaderRow(row: unknown[]): number {
  if (!row || row.length === 0) {
    return 0;
  }

  let score = 0;

  for (const cell of row) {
    const cellText = normalizeText(cell).toLowerCase();
    if (!cellText) {
      continue;
    }

    for (const keyword of TABLE_HEADER_HINTS) {
      const keywordText = keyword.toLowerCase();
      if (cellText === keywordText || cellText.includes(keywordText)) {
        score += 1;
        break;
      }
    }
  }

  return score;
}

function inferHeaderRowIndex(rows: unknown[][], explicitIndex?: number): number {
  if (typeof explicitIndex === "number" && explicitIndex >= 0 && explicitIndex < rows.length) {
    return explicitIndex;
  }

  let headerRowIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < Math.min(30, rows.length); i += 1) {
    const score = scoreHeaderRow(rows[i]);
    if (score > bestScore) {
      bestScore = score;
      headerRowIndex = i;
    }
  }

  if (headerRowIndex === -1 || bestScore < 2) {
    return -1;
  }

  return headerRowIndex;
}

function getHeadersFromRow(rawHeaders: unknown[]): { headers: string[]; validColumns: number[] } {
  const headers: string[] = [];
  const validColumns: number[] = [];

  for (let col = 0; col < rawHeaders.length; col += 1) {
    const header = normalizeText(rawHeaders[col]);
    if (header) {
      const uniqueHeader = headers.includes(header) ? `${header}_${col + 1}` : header;
      headers.push(uniqueHeader);
      validColumns.push(col);
    }
  }

  return { headers, validColumns };
}

function rowHasStopKeyword(row: unknown[], stopKeywords: string[] = STOP_KEYWORDS): boolean {
  const firstText = normalizeText(row.find((cell) => normalizeText(cell) !== ""));
  return stopKeywords.some((keyword) => firstText.includes(keyword));
}

export function createSummaryFingerprint(summary: FileStructureSummary, headers: string[]): string {
  const sheetKey = summary.sheets
    .map((sheet) => `${sheet.name}:${sheet.columnCount}:${sheet.sampleRows[0]?.join(",") ?? ""}`)
    .join("|");
  return `${summary.fileType}:${headers.join("|")}:${sheetKey}`.slice(0, 500);
}

function summarizeWorkbook(fileName: string, workbook: XLSX.WorkBook): FileStructureSummary {
  const sheets = workbook.SheetNames.map((name) => {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      defval: "",
    });

    return {
      name,
      rowCount: rows.length,
      columnCount: Math.max(0, ...rows.map((row) => row.length)),
      sampleRows: rows.slice(0, 12).map((row) => compactRow(row).slice(0, 24)),
    };
  });

  return { fileName, fileType: "spreadsheet", sheets };
}

function getWorkbookRows(workbook: XLSX.WorkBook): WorkbookRows {
  return workbook.SheetNames.reduce<WorkbookRows>((acc, name) => {
    acc[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      defval: "",
    });
    return acc;
  }, {});
}

function resolveSheetNames(workbook: XLSX.WorkBook, rule?: ParsingRule): string[] {
  if (rule?.sheetMode === "all") {
    return workbook.SheetNames;
  }

  if (workbook.SheetNames.length === 1) {
    return workbook.SheetNames;
  }

  const ranked = workbook.SheetNames
    .map((sheetName) => {
      const rows: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        defval: "",
      });
      const score = Math.max(0, ...rows.slice(0, 30).map(scoreHeaderRow));
      return { sheetName, score };
    })
    .sort((a, b) => b.score - a.score);

  return [ranked[0]?.sheetName ?? workbook.SheetNames[0]];
}

function readAdjacentValue(rows: unknown[][], label: string, offset = 1, pattern?: string): string {
  for (const row of rows) {
    for (let col = 0; col < row.length; col += 1) {
      const text = normalizeText(row[col]);
      if (!text.includes(label)) {
        continue;
      }

      if (pattern) {
        const match = text.match(new RegExp(pattern));
        if (match?.[1]) {
          return match[1].trim();
        }
      }

      const adjacent = normalizeText(row[col + offset]);
      if (adjacent) {
        return adjacent;
      }

      const inlineValue = text.replace(label, "").replace(/^[:：\s]+/, "").trim();
      if (inlineValue) {
        return inlineValue;
      }
    }
  }

  return "";
}

function inferFooterExtractors(rows: unknown[][]): FooterExtractor[] {
  const candidates: FooterExtractor[] = [
    { label: "收货门店", field: "storeName" },
    { label: "收货机构", field: "storeName" },
    { label: "调入门店", field: "storeName" },
    { label: "收货人", field: "receiverName" },
    { label: "联系人", field: "receiverName" },
    { label: "联系电话", field: "receiverPhone" },
    { label: "收货电话", field: "receiverPhone" },
    { label: "电话", field: "receiverPhone" },
    { label: "收货地址", field: "receiverAddress" },
    { label: "地址", field: "receiverAddress" },
    { label: "单据号", field: "externalCode" },
    { label: "配送单号", field: "externalCode" },
  ];

  return candidates.filter((candidate) => readAdjacentValue(rows, candidate.label));
}

function collectFooterDefaults(rows: unknown[][], extractors: FooterExtractor[] = []): Partial<Record<SystemFieldKey, string>> {
  const defaults: Partial<Record<SystemFieldKey, string>> = {};
  for (const extractor of extractors) {
    const value = readAdjacentValue(rows, extractor.label, extractor.valueOffset ?? 1, extractor.pattern);
    if (value) {
      defaults[extractor.field] = value;
    }
  }
  return defaults;
}

function mergeDefaults(
  row: ParsedRow,
  mapping: MappingState,
  defaults: Partial<Record<SystemFieldKey, string>> = {},
): ParsedRow {
  const nextRow = { ...row };
  for (const [fieldKey, value] of Object.entries(defaults) as Array<[SystemFieldKey, string]>) {
    const mappedHeader = mapping[fieldKey] || SYSTEM_HEADER_BY_KEY[fieldKey];
    if (!normalizeText(nextRow[mappedHeader])) {
      nextRow[mappedHeader] = value;
    }
  }
  return nextRow;
}

function parseColumnSheet(
  sheetName: string,
  rows: unknown[][],
  rule?: ParsingRule,
  onProgress?: (current: number) => void,
): { headers: string[]; data: ParsedRow[] } {
  const headerRowIndex = inferHeaderRowIndex(rows, rule?.headerRowIndex);
  if (headerRowIndex === -1) {
    return { headers: [], data: [] };
  }

  const { headers, validColumns } = getHeadersFromRow(rows[headerRowIndex]);
  const mapping = rule?.mapping && Object.keys(rule.mapping).length > 0 ? rule.mapping : heuristicMapHeaders(headers);
  const footerExtractors = rule?.footerExtractors?.length ? rule.footerExtractors : inferFooterExtractors(rows);
  const footerDefaults = {
    ...collectFooterDefaults(rows, footerExtractors),
    ...(rule?.defaults ?? {}),
  };
  const stopKeywords = rule?.stopKeywords?.length ? rule.stopKeywords : STOP_KEYWORDS;
  const parsedRows: ParsedRow[] = [];

  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const rowArray = rows[i];
    if (rowHasStopKeyword(rowArray, stopKeywords)) {
      continue;
    }

    const nonEmptyCells = validColumns.filter((colIndex) => normalizeText(rowArray?.[colIndex]) !== "");
    if (nonEmptyCells.length === 0) {
      continue;
    }

    const parsedRow: ParsedRow = {
      _originalRowIndex: i + 1,
      _sheetName: sheetName,
    };

    headers.forEach((header, index) => {
      const colIndex = validColumns[index];
      parsedRow[header] = normalizeCellValue(rowArray?.[colIndex]);
    });

    parsedRows.push(mergeDefaults(parsedRow, mapping, footerDefaults));
    onProgress?.(1);
  }

  return { headers, data: parsedRows };
}

function parseCardSheet(sheetName: string, rows: unknown[][], rule?: ParsingRule): { headers: string[]; data: ParsedRow[] } {
  const headers = SYSTEM_FIELDS.map((field) => field.label);
  const mapping = createSystemMapping();
  const records: ParsedRow[] = [];
  let blockStart = -1;

  const flushBlock = (start: number, end: number) => {
    if (start < 0 || end <= start) {
      return;
    }

    const block = rows.slice(start, end);
    const defaults = {
      ...collectFooterDefaults(block, rule?.footerExtractors?.length ? rule.footerExtractors : inferFooterExtractors(block)),
      ...(rule?.defaults ?? {}),
    };
    const headerIndex = block.findIndex((row) => scoreHeaderRow(row) >= 2);
    if (headerIndex === -1) {
      return;
    }

    const { headers: itemHeaders, validColumns } = getHeadersFromRow(block[headerIndex]);
    const itemMapping = {
      ...heuristicMapHeaders(itemHeaders),
      ...rule?.mapping,
    };

    for (let i = headerIndex + 1; i < block.length; i += 1) {
      const itemRow = block[i];
      if (rowHasStopKeyword(itemRow) || validColumns.every((col) => normalizeText(itemRow[col]) === "")) {
        continue;
      }

      const parsedRow: ParsedRow = {
        _originalRowIndex: start + i + 1,
        _sheetName: sheetName,
      };

      for (const field of SYSTEM_FIELDS) {
        const sourceHeader = itemMapping[field.key];
        if (!sourceHeader) {
          continue;
        }
        const sourceIndex = itemHeaders.indexOf(sourceHeader);
        if (sourceIndex !== -1) {
          parsedRow[mapping[field.key] ?? field.label] = normalizeCellValue(itemRow[validColumns[sourceIndex]]);
        }
      }

      records.push(mergeDefaults(parsedRow, mapping, defaults));
    }
  };

  for (let i = 0; i < rows.length; i += 1) {
    const rowText = compactRow(rows[i]).join(" ");
    const isBoundary = /记录\s*#?\d+|调拨记录|配送记录|订单\s*#?\d+/.test(rowText);
    if (!isBoundary) {
      continue;
    }

    flushBlock(blockStart, i);
    blockStart = i;
  }

  flushBlock(blockStart === -1 ? 0 : blockStart, rows.length);

  return { headers, data: records };
}

function parseMatrixSheet(sheetName: string, rows: unknown[][], rule?: ParsingRule): { headers: string[]; data: ParsedRow[] } {
  const headerRowIndex = inferHeaderRowIndex(rows, rule?.headerRowIndex);
  if (headerRowIndex === -1) {
    return { headers: [], data: [] };
  }

  const rawHeaderRow = rows[headerRowIndex];
  const headers = SYSTEM_FIELDS.map((field) => field.label);
  const matrix = rule?.matrix ?? {};
  const rowHeaders = compactRow(rawHeaderRow);
  const rowMapping = {
    ...heuristicMapHeaders(rowHeaders),
    ...(matrix.rowFieldMap ?? {}),
  };
  const dynamicColumnStart =
    matrix.dynamicColumnStart ??
    Math.max(
      0,
      rowHeaders.findIndex((header) => /门店|周一|周二|周三|周四|周五|日期|数量/.test(header)),
    );
  const columnHeaderField = matrix.columnHeaderField ?? "storeName";
  const quantityField = matrix.quantityField ?? "skuQuantity";
  const result: ParsedRow[] = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (rowHasStopKeyword(row)) {
      continue;
    }

    for (let col = dynamicColumnStart; col < rawHeaderRow.length; col += 1) {
      const quantityText = normalizeText(row[col]);
      if (!quantityText || quantityText === "0") {
        continue;
      }

      const baseRow: ParsedRow = {
        _originalRowIndex: rowIndex + 1,
        _sheetName: sheetName,
        [SYSTEM_HEADER_BY_KEY[columnHeaderField]]: normalizeText(rawHeaderRow[col]),
        [SYSTEM_HEADER_BY_KEY[quantityField]]: quantityText,
      };

      for (const field of SYSTEM_FIELDS) {
        const sourceHeader = rowMapping[field.key];
        const sourceIndex = sourceHeader ? rowHeaders.indexOf(sourceHeader) : -1;
        if (sourceIndex >= 0) {
          baseRow[SYSTEM_HEADER_BY_KEY[field.key]] = normalizeCellValue(row[sourceIndex]);
        }
      }

      result.push(mergeDefaults(baseRow, createSystemMapping(), rule?.defaults));
    }
  }

  return { headers, data: result };
}

export function createSystemMapping(): MappingState {
  return SYSTEM_FIELDS.reduce<MappingState>((acc, field) => {
    acc[field.key] = field.label;
    return acc;
  }, {});
}

export function createDefaultRule(headers: string[], fileName = "未命名规则"): ParsingRule {
  return {
    name: `${fileName.replace(/\.[^.]+$/, "") || "新建"}字段规则`,
    mode: "column",
    sheetMode: "all",
    mapping: heuristicMapHeaders(headers),
    stopKeywords: STOP_KEYWORDS,
    aiNotes: ["系统已按表头关键字起草字段映射，请核对收货信息和 SKU 字段是否准确。"],
  };
}

export function normalizeRule(input: unknown, fallbackHeaders: string[] = [], fileName = "新建规则"): ParsingRule {
  const value = typeof input === "object" && input !== null ? (input as Partial<ParsingRule>) : {};
  const mode: RuleMode = ["column", "card", "matrix", "text"].includes(String(value.mode))
    ? (value.mode as RuleMode)
    : "column";
  const sheetMode: SheetMode = value.sheetMode === "first" ? "first" : "all";
  const mapping =
    value.mapping && typeof value.mapping === "object"
      ? (value.mapping as MappingState)
      : heuristicMapHeaders(fallbackHeaders);

  return {
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : `${fileName.replace(/\.[^.]+$/, "")}字段规则`,
    mode,
    sheetMode,
    mapping,
    headerRowIndex: typeof value.headerRowIndex === "number" ? value.headerRowIndex : undefined,
    footerExtractors: Array.isArray(value.footerExtractors) ? value.footerExtractors : [],
    defaults: value.defaults && typeof value.defaults === "object" ? value.defaults : {},
    stopKeywords: Array.isArray(value.stopKeywords) ? value.stopKeywords : STOP_KEYWORDS,
    matrix: value.matrix && typeof value.matrix === "object" ? value.matrix : undefined,
    text: value.text && typeof value.text === "object" ? value.text : undefined,
    aiNotes: Array.isArray(value.aiNotes) ? value.aiNotes.map(String) : [],
    confidence: typeof value.confidence === "number" ? value.confidence : undefined,
  };
}

export function parseExcelFile(
  file: File,
  rule?: ParsingRule | null,
  onProgress?: (pct: number, current: number, total: number) => void,
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const buffer = event.target?.result;
        if (!buffer) {
          throw new Error("文件读取失败");
        }

        const workbook = XLSX.read(buffer, { type: "array" });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error("Excel 文件中没有有效的 Sheet");
        }

        const summary = summarizeWorkbook(file.name, workbook);
        const workbookRows = getWorkbookRows(workbook);
        const sheetNames = resolveSheetNames(workbook, rule ?? undefined);
        const totalRows = sheetNames.reduce((sum, sheetName) => sum + (workbookRows[sheetName]?.length ?? 0), 0);
        const allRows: ParsedRow[] = [];
        let allHeaders: string[] = [];
        let current = 0;

        for (const sheetName of sheetNames) {
          const rows = workbookRows[sheetName] ?? [];
          const mode = rule?.mode ?? "column";
          const parsed =
            mode === "card"
              ? parseCardSheet(sheetName, rows, rule ?? undefined)
              : mode === "matrix"
                ? parseMatrixSheet(sheetName, rows, rule ?? undefined)
                : parseColumnSheet(sheetName, rows, rule ?? undefined, (count) => {
                    current = Math.min(totalRows, current + count);
                    onProgress?.(Math.round((current / Math.max(totalRows, 1)) * 100), current, totalRows);
                  });

          allHeaders = Array.from(new Set([...allHeaders, ...parsed.headers]));
          allRows.push(...parsed.data);
        }

        if (allRows.length === 0) {
          throw new Error("未生成有效明细，请新建或调整字段规则");
        }

        const fingerprint = createSummaryFingerprint(summary, allHeaders);
        onProgress?.(100, allRows.length, allRows.length);
        resolve({ headers: allHeaders, data: allRows, fingerprint, summary });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error("文件读取失败，请检查文件编码或格式"));
    };

    reader.readAsArrayBuffer(file);
  });
}

export function summarizeExcelFile(file: File): Promise<FileStructureSummary> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const buffer = event.target?.result;
        if (!buffer) {
          throw new Error("文件读取失败");
        }
        const workbook = XLSX.read(buffer, { type: "array" });
        resolve(summarizeWorkbook(file.name, workbook));
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error("文件读取失败，请检查文件编码或格式"));
    reader.readAsArrayBuffer(file);
  });
}

export function inferHeadersFromSummary(summary: FileStructureSummary): string[] {
  let bestRow: string[] = [];
  let bestScore = 0;

  for (const sheet of summary.sheets) {
    for (const row of sheet.sampleRows) {
      const score = scoreHeaderRow(row);
      if (score > bestScore) {
        bestScore = score;
        bestRow = row;
      }
    }
  }

  return bestRow.filter(Boolean);
}

export function heuristicMapHeaders(headers: string[]): MappingState {
  const mapping: MappingState = {};
  const usedHeaders = new Set<string>();

  for (const field of SYSTEM_FIELDS) {
    const candidates = HEADER_KEYWORDS[field.key];
    for (const candidate of candidates) {
      const matchedHeader = headers.find(
        (header) =>
          !usedHeaders.has(header) &&
          normalizeText(header).toLowerCase() === candidate.toLowerCase(),
      );

      if (matchedHeader) {
        mapping[field.key] = matchedHeader;
        usedHeaders.add(matchedHeader);
        break;
      }
    }
  }

  for (const field of SYSTEM_FIELDS) {
    if (mapping[field.key]) {
      continue;
    }

    const candidates = HEADER_KEYWORDS[field.key];
    for (const candidate of candidates) {
      const matchedHeader = headers.find((header) => {
        const text = normalizeText(header).toLowerCase();
        const keyword = candidate.toLowerCase();
        return !usedHeaders.has(header) && (text.includes(keyword) || keyword.includes(text));
      });

      if (matchedHeader) {
        mapping[field.key] = matchedHeader;
        usedHeaders.add(matchedHeader);
        break;
      }
    }
  }

  return mapping;
}

export function getMappingConfidence(mapping: MappingState): {
  mapped: number;
  total: number;
  score: number;
} {
  const importantFields = ["skuCode", "skuName", "skuQuantity"] satisfies SystemFieldKey[];
  const hasStore = Boolean(mapping.storeName);
  const hasReceiver = Boolean(mapping.receiverName && mapping.receiverPhone && mapping.receiverAddress);
  const mappedImportant = importantFields.filter((key) => {
    const header = mapping[key];
    return typeof header === "string" && header.trim() !== "";
  }).length;
  const mapped = mappedImportant + (hasStore || hasReceiver ? 1 : 0);
  const total = importantFields.length + 1;

  return {
    mapped,
    total,
    score: total > 0 ? mapped / total : 0,
  };
}

export function getMappedValue(row: ParsedRow, mapping: MappingState, fieldKey: SystemFieldKey): string {
  const sourceHeader = mapping[fieldKey] || SYSTEM_HEADER_BY_KEY[fieldKey];
  return normalizeText(row[sourceHeader]);
}

export function toSystemRow(row: ParsedRow, mapping: MappingState): Record<SystemFieldKey, string> {
  return SYSTEM_FIELDS.reduce<Record<SystemFieldKey, string>>((acc, field) => {
    acc[field.key] = getMappedValue(row, mapping, field.key);
    return acc;
  }, {} as Record<SystemFieldKey, string>);
}
