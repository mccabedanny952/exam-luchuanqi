import * as XLSX from "xlsx";

export type SystemFieldKey =
  | "externalCode"
  | "senderName"
  | "senderPhone"
  | "senderAddress"
  | "receiverName"
  | "receiverPhone"
  | "receiverAddress"
  | "weight"
  | "count"
  | "tempZone"
  | "remark";

export interface ParsedRow {
  _originalRowIndex: number;
  [key: string]: string | number | null | undefined;
}

export interface ParseResult {
  headers: string[];
  data: ParsedRow[];
  fingerprint: string;
}

export interface SystemFieldDefinition {
  key: SystemFieldKey;
  label: string;
  required: boolean;
}

export interface ValidationIssue {
  rowIndex: number;
  fieldKey: SystemFieldKey;
  msg: string;
}

export type MappingState = Partial<Record<SystemFieldKey, string>>;

function normalizeCellValue(value: unknown): string | number | null | undefined {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return String(value);
}

export const SYSTEM_FIELDS: SystemFieldDefinition[] = [
  { key: "externalCode", label: "外部编码", required: false },
  { key: "senderName", label: "发件人姓名", required: true },
  { key: "senderPhone", label: "发件人电话", required: true },
  { key: "senderAddress", label: "发件人地址", required: true },
  { key: "receiverName", label: "收件人姓名", required: true },
  { key: "receiverPhone", label: "收件人电话", required: true },
  { key: "receiverAddress", label: "收件人地址", required: true },
  { key: "weight", label: "重量 (kg)", required: true },
  { key: "count", label: "件数", required: true },
  { key: "tempZone", label: "温层", required: true },
  { key: "remark", label: "备注", required: false },
];

const ALL_HEADER_KEYWORDS = [
  "外部编码",
  "外部订单号",
  "客户单号",
  "订单号",
  "单号",
  "发件人",
  "寄件人",
  "发货人",
  "发方",
  "发件人电话",
  "发件电话",
  "发货电话",
  "寄件人电话",
  "发件人地址",
  "发件地址",
  "发货地址",
  "寄件地址",
  "收件人",
  "收货人",
  "收方",
  "收件人电话",
  "收件电话",
  "收货电话",
  "收件人地址",
  "收件地址",
  "收货地址",
  "重量",
  "件数",
  "数量",
  "温层",
  "温度要求",
  "备注",
  "附言",
  "sender",
  "receiver",
  "weight",
  "qty",
  "temp zone",
  "note",
  "ref code",
  "sender tel",
  "receiver tel",
  "sender address",
  "receiver address",
];

function scoreHeaderRow(row: unknown[]): number {
  if (!row || row.length === 0) {
    return 0;
  }

  let score = 0;

  for (const cell of row) {
    const cellText = String(cell ?? "").trim().toLowerCase();
    if (!cellText) {
      continue;
    }

    for (const keyword of ALL_HEADER_KEYWORDS) {
      if (cellText === keyword.toLowerCase() || cellText.includes(keyword.toLowerCase())) {
        score += 1;
        break;
      }
    }
  }

  return score;
}

function findDataSheet(workbook: XLSX.WorkBook): string {
  const sheetNames = workbook.SheetNames;

  if (sheetNames.length === 1) {
    return sheetNames[0];
  }

  const dataKeywords = ["订单", "数据", "data", "order", "导入", "下单"];
  for (const sheetName of sheetNames) {
    if (dataKeywords.some((keyword) => sheetName.toLowerCase().includes(keyword.toLowerCase()))) {
      return sheetName;
    }
  }

  const firstSheet = workbook.Sheets[sheetNames[0]];
  const firstRows: unknown[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });
  if (firstRows.length > 0) {
    const sampledRows = firstRows.slice(0, 5);
    const maxCols = Math.max(
      ...sampledRows.map((row) =>
        row.filter((cell) => cell !== "" && cell !== null && cell !== undefined).length
      ),
    );

    if (maxCols <= 3 && sheetNames.length > 1) {
      return sheetNames[1];
    }
  }

  return sheetNames[0];
}

export function parseExcelFile(
  file: File,
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

        const sheetName = findDataSheet(workbook);
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
          throw new Error(`Sheet "${sheetName}" 不存在`);
        }

        const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: "",
        });

        if (rawData.length === 0) {
          throw new Error("Excel 文件为空，未找到任何数据");
        }

        let headerRowIndex = -1;
        let bestScore = 0;

        for (let i = 0; i < Math.min(20, rawData.length); i += 1) {
          const score = scoreHeaderRow(rawData[i]);
          if (score > bestScore) {
            bestScore = score;
            headerRowIndex = i;
          }
        }

        if (headerRowIndex === -1 || bestScore < 3) {
          throw new Error("无法在 Excel 中找到有效的表头行，请检查文件格式");
        }

        const rawHeaders = rawData[headerRowIndex];
        const headers: string[] = [];
        const validColumns: number[] = [];

        for (let col = 0; col < rawHeaders.length; col += 1) {
          const header = String(rawHeaders[col] ?? "").trim();
          if (header) {
            headers.push(header);
            validColumns.push(col);
          }
        }

        if (headers.length < 3) {
          throw new Error("表头列数不足，无法解析为有效的订单数据");
        }

        const fingerprint = headers.join("|");
        const totalRows = rawData.length - headerRowIndex - 1;
        const rows: ParsedRow[] = [];

        for (let i = headerRowIndex + 1; i < rawData.length; i += 1) {
          const rowArray = rawData[i];
          const nonEmptyCells = validColumns.filter((colIndex) => {
            const cell = rowArray?.[colIndex];
            return cell !== "" && cell !== null && cell !== undefined;
          });

          if (nonEmptyCells.length === 0) {
            continue;
          }

          const parsedRow: ParsedRow = {
            _originalRowIndex: i + 1,
          };

          headers.forEach((header, index) => {
            const colIndex = validColumns[index];
            const value = rowArray?.[colIndex];
            parsedRow[header] = normalizeCellValue(value);
          });

          rows.push(parsedRow);

          if (onProgress && totalRows > 0) {
            const pct = Math.round(((i - headerRowIndex) / totalRows) * 100);
            onProgress(Math.min(pct, 100), i - headerRowIndex, totalRows);
          }
        }

        if (rows.length === 0) {
          throw new Error("Excel 解析后没有有效的数据行");
        }

        if (onProgress) {
          onProgress(100, rows.length, rows.length);
        }

        resolve({ headers, data: rows, fingerprint });
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

export function heuristicMapHeaders(headers: string[]): MappingState {
  const mapping: MappingState = {};
  const usedHeaders = new Set<string>();

  const rules: Record<SystemFieldKey, string[]> = {
    externalCode: [
      "外部编码",
      "外部订单号",
      "客户单号",
      "订单号",
      "外部单号",
      "单号",
      "ref code",
      "order id",
      "order no",
    ],
    senderName: [
      "发件人姓名",
      "发件人",
      "寄件人姓名",
      "寄件人",
      "发货人",
      "发方",
      "sender name",
      "sender",
    ],
    senderPhone: [
      "发件人电话",
      "发件人手机",
      "发件电话",
      "寄件人电话",
      "寄件人联系方式",
      "发货电话",
      "发方电话",
      "sender tel",
      "sender phone",
    ],
    senderAddress: [
      "发件人地址",
      "发件地址",
      "寄件人地址",
      "寄件人完整地址",
      "寄件地址",
      "发货地址",
      "发方地址",
      "sender address",
      "sender addr",
    ],
    receiverName: [
      "收件人姓名",
      "收件人",
      "收货人姓名",
      "收货人",
      "收方",
      "receiver name",
      "receiver",
      "consignee",
    ],
    receiverPhone: [
      "收件人电话",
      "收件人手机",
      "收件电话",
      "收货人联系方式",
      "收货电话",
      "收方电话",
      "receiver tel",
      "receiver phone",
    ],
    receiverAddress: [
      "收件人地址",
      "收件地址",
      "收货人地址",
      "收货人完整地址",
      "收货地址",
      "收方地址",
      "receiver address",
      "receiver addr",
    ],
    weight: ["重量(kg)", "重量(KG)", "重量", "weight(kg)", "weight"],
    count: ["件数", "包裹数", "包裹数量", "数量", "qty", "quantity"],
    tempZone: [
      "温层",
      "温度要求",
      "温度",
      "冷藏要求",
      "储运条件",
      "temp zone",
      "temperature",
    ],
    remark: ["备注", "附言", "附加说明", "留言", "note", "remark", "memo"],
  };

  for (const field of SYSTEM_FIELDS) {
    const possibleHeaders = rules[field.key];
    for (const candidate of possibleHeaders) {
      const matchedHeader = headers.find(
        (header) =>
          !usedHeaders.has(header) &&
          header.toLowerCase().trim() === candidate.toLowerCase().trim(),
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

    const possibleHeaders = rules[field.key];
    for (const candidate of possibleHeaders) {
      const matchedHeader = headers.find(
        (header) => !usedHeaders.has(header) && header.toLowerCase().includes(candidate.toLowerCase()),
      );

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
  const requiredFields = SYSTEM_FIELDS.filter((field) => field.required);
  const mappedRequired = requiredFields.filter((field) => {
    const header = mapping[field.key];
    return typeof header === "string" && header.trim() !== "";
  }).length;

  return {
    mapped: mappedRequired,
    total: requiredFields.length,
    score: requiredFields.length > 0 ? mappedRequired / requiredFields.length : 0,
  };
}
