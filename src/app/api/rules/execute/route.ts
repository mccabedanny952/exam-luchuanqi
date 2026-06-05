import { NextResponse } from "next/server";
import { requestLlmJson } from "@/lib/llm";
import {
  createSystemMapping,
  normalizeRule,
  type ParsedRow,
  type ParsingRule,
} from "@/utils/excel-tools";

interface ExecuteRuleBody {
  fileName?: string;
  text?: string;
  rule?: ParsingRule;
}

interface ExecuteRuleResponse {
  rows?: Array<Record<string, string | number | null>>;
  warnings?: string[];
}

const SYSTEM_PROMPT = `你是物流出库单文本解析执行器。
用户已经确认了一条字段规则，你必须按规则处理 Word/PDF 文本，输出结构化 JSON。
只输出 JSON，不要输出 Markdown。
每条明细必须包含这些中文字段名：外部编码、收货门店、收件人姓名、收件人电话、收件人地址、SKU物品编码、SKU物品名称、SKU发货数量、SKU规格型号、备注。
同一个外部编码下的多 SKU 行可以共享同一组收货信息。
遇到合计、签字、制单人、打印时间等非明细行要跳过。
如果字段来自推测或文本缺失，请保留空字符串，并在 warnings 中说明。返回结构：{"rows":[],"warnings":[]}`;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExecuteRuleBody;

    if (!body.text?.trim()) {
      return NextResponse.json({ error: "待处理文本不能为空" }, { status: 400 });
    }

    const rule = normalizeRule(body.rule, [], body.fileName || "文本文件");
    const response = await requestLlmJson<ExecuteRuleResponse>({
      timeoutMs: 60_000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            fileName: body.fileName,
            rule,
            text: body.text.slice(0, 60_000),
          }),
        },
      ],
    });

    const rows: ParsedRow[] = (response.rows ?? []).map((row, index) => ({
      _originalRowIndex: index + 1,
      _source: "LLM",
      ...row,
    }));

    return NextResponse.json({
      rows,
      headers: Object.values(createSystemMapping()),
      warnings: response.warnings ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "执行字段规则失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
