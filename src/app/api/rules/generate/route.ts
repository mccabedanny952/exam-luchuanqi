import { NextResponse } from "next/server";
import { requestLlmJson } from "@/lib/llm";
import { normalizeRule, type FileStructureSummary, type ParsingRule } from "@/utils/excel-tools";

interface GenerateRuleBody {
  summary?: FileStructureSummary;
}

interface LlmRuleResponse {
  rule?: ParsingRule;
}

const SYSTEM_PROMPT = `你是物流出库单字段规则设计器。
你只能输出 JSON，不要输出 Markdown。
目标不是直接生成明细，而是根据文件结构生成一条可编辑、可复用的字段规则。
字段必须使用这些 key：externalCode, storeName, receiverName, receiverPhone, receiverAddress, skuCode, skuName, skuQuantity, skuSpec, remark。
规则模式：
- column：普通表格、跳过干扰头部、尾部键值补充、跨行聚合基础格式。
- card：一条记录由标题、收货信息、小物品表组成的卡片式格式。
- matrix：SKU/门店/日期等横向矩阵，需要转置成明细行。
- text：Word/PDF 纯文本或多单文本。
必须标注 aiNotes，说明哪些映射是推测的，提醒用户确认。
返回结构：{"rule": ParsingRule}。`;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateRuleBody;

    if (!body.summary) {
      return NextResponse.json({ error: "文件结构不能为空" }, { status: 400 });
    }

    const response = await requestLlmJson<LlmRuleResponse>({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            task: "请为这个文件生成一条通用字段规则，禁止按文件名做特殊分支。",
            summary: body.summary,
          }),
        },
      ],
    });

    const rule = normalizeRule(response.rule, [], body.summary.fileName);
    return NextResponse.json({ rule });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 起草规则失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
