/**
 * 与 LLM 服务通信：环境变量配置 + 一次 Chat Completions 请求。
 * 不依赖任何 SDK，直接用 fetch，可对接 OpenAI / DeepSeek / GLM / Ollama 等服务。
 */
import type { ChatMessage, LLMConfig, ToolSchema } from "./types.js";

/** 从环境变量读取配置，缺失时给出可操作的提示 */
export function loadConfig(): LLMConfig {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "缺少环境变量 OPENAI_API_KEY。\n" +
        "  必填: OPENAI_API_KEY   API 密钥（本地 Ollama 可填任意非空值，如 ollama）\n" +
        "  可选: OPENAI_BASE_URL  默认为 https://api.openai.com/v1\n" +
        "        MODEL            默认为 gpt-4o-mini\n" +
        "各平台（bash / PowerShell / cmd）的设置命令见 README「快速开始」。"
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
    // 注意：工具调用的约定不在 system prompt 里，而在请求体的 tools 字段。
    // tools 是 API 的一等参数，服务端会把这些 JSON Schema 按模型内部模板渲染，
    // 模型经过 function calling 微调后，才知道"需要外部信息时输出 tool_calls 而非自然语言"。
    // 所以：tools 决定"能不能调、叫什么名、参数长什么样"，
    //       system prompt 只影响"要不要调、什么时候调"。
    // 把 tools 传成空数组，模型基本就不会再返回 tool_calls。
    body: JSON.stringify({ model: config.model, messages, tools }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    throw new Error(`LLM 请求失败 ${res.status}: ${await res.text()}`);
  }

  // 教学简化：直接断言返回结构。生产代码应做运行时校验（如 zod），
  // 否则服务返回异常结构时只会在更远处报错，难以定位。
  const data = await res.json();
  const message = data.choices?.[0]?.message as ChatMessage | undefined;
  if (!message) {
    throw new Error(`LLM 返回结构异常: ${JSON.stringify(data)}`);
  }
  return message;
}
