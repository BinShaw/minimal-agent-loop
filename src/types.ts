/**
 * 与 OpenAI 兼容 Chat Completions API 相关的共享类型。
 * 本文件只有类型，不含任何运行时代码；网络请求见 llm.ts，主循环见 agent.ts。
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

/** LLM 服务配置，由 llm.ts 的 loadConfig() 从环境变量构造 */
export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}
