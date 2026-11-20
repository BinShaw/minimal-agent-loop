/**
 * 与 OpenAI 兼容 Chat Completions API 相关的共享类型。
 * 不依赖任何 SDK，直接用 fetch 调用，可对接 OpenAI / DeepSeek / GLM / Ollama 等服务。
 */

/** 模型返回的一次工具调用请求 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON 字符串形式的参数 */
    arguments: string;
  };
}

/** 对话消息（含工具角色），与 API 的 messages 数组结构一致 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** assistant 消息携带的工具调用请求 */
  tool_calls?: ToolCall[];
  /** tool 消息对应的调用 id */
  tool_call_id?: string;
}

/** 传给 API 的工具 JSON Schema 定义 */
export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/** LLM 服务配置，从环境变量读取 */
export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function loadConfig(): LLMConfig {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "缺少环境变量 OPENAI_API_KEY。\n" +
        "  直连 OpenAI:      set OPENAI_API_KEY=sk-...\n" +
        "  使用兼容服务:     set OPENAI_BASE_URL=https://api.deepseek.com/v1\n" +
        "                    set OPENAI_API_KEY=...\n" +
        "                    set MODEL=deepseek-chat\n" +
        "  本地 Ollama:      set OPENAI_BASE_URL=http://localhost:11434/v1"
    );
  }
  return {
    baseUrl: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    apiKey,
    model: process.env.MODEL ?? "gpt-4o-mini",
  };
}

/** 调用一次 Chat Completions，返回 assistant 消息（可能含 tool_calls） */
export async function chat(
  messages: ChatMessage[],
  tools: ToolSchema[],
  config: LLMConfig
): Promise<ChatMessage> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, messages, tools }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    throw new Error(`LLM 请求失败 ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const message = data.choices?.[0]?.message as ChatMessage | undefined;
  if (!message) {
    throw new Error(`LLM 返回结构异常: ${JSON.stringify(data)}`);
  }
  return message;
}
