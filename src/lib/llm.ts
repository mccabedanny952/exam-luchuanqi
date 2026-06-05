export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmJsonOptions {
  messages: ChatMessage[];
  temperature?: number;
  timeoutMs?: number;
  maxTokens?: number;
}

interface LlmApiPayload {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    message?: {
      content?: string;
    };
  }>;
}

function getLlmConfig() {
  return {
    baseUrl: process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || "",
    apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "",
    model: process.env.LLM_MODEL || "gpt-5.5",
  };
}

function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonResponse(text: string): LlmApiPayload {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("大模型返回为空");
  }

  if (!trimmed.startsWith("data:")) {
    return JSON.parse(trimmed) as LlmApiPayload;
  }

  const chunks = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""))
    .filter((line) => line && line !== "[DONE]");

  if (chunks.length === 0) {
    throw new Error("大模型流式返回为空");
  }

  const parsedChunks = chunks.map((chunk) => JSON.parse(chunk) as LlmApiPayload);
  const directChoice = parsedChunks.find((chunk) => chunk?.choices?.[0]?.message?.content);
  if (directChoice) {
    return directChoice;
  }

  const content = parsedChunks
    .map((chunk) => chunk?.choices?.[0]?.delta?.content ?? "")
    .join("");

  return {
    choices: [
      {
        message: {
          content,
        },
      },
    ],
  };
}

export async function requestLlmJson<T>({
  messages,
  temperature = 0.2,
  timeoutMs = 90_000,
  maxTokens = 4096,
}: LlmJsonOptions): Promise<T> {
  const { baseUrl, apiKey, model } = getLlmConfig();

  if (!baseUrl || !apiKey) {
    throw new Error("LLM_BASE_URL 或 LLM_API_KEY 未配置");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        stream: true,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`大模型请求失败：${response.status} ${errorText.slice(0, 180)}`);
    }

    const rawText = await response.text();
    const payload = parseJsonResponse(rawText);
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("大模型返回为空");
    }

    return JSON.parse(stripJsonFence(content)) as T;
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message))) {
      throw new Error(`大模型请求超过 ${Math.round(timeoutMs / 1000)} 秒未返回，请稍后重试，或缩短文本内容后再试`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
