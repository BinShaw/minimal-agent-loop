/**
 * 核心 ReAct 循环：推理（Reason）→ 行动（Act）→ 观察（Observe），循环直到模型给出最终回答。
 *
 * 一轮迭代：
 *   1. Reason: 把整个对话（含之前的工具观察）发给 LLM
 *   2. Act:    若模型返回 tool_calls → 执行工具，把结果作为 tool 消息追加进历史（Observe）
 *   3.         若无 tool_calls → 模型已得出答案，循环结束
 */
import type { ChatMessage, LLMConfig, ToolCall } from "./types.js";
import { chat } from "./types.js";
import type { Tool } from "./tools.js";

export interface AgentStep {
  /** 本轮模型的思考/回答文本（可能为空） */
  text: string;
  /** 本轮请求执行的工具调用（无则表示循环结束） */
  toolCalls: ToolCall[];
  /** 各工具的执行结果，key 为 tool_call id */
  results: Record<string, string>;
}

export interface AgentOptions {
  systemPrompt?: string;
  maxSteps?: number;
  /** 每个工具步骤完成后的回调，用于 CLI 打印过程 */
  onStep?: (step: AgentStep, stepNumber: number) => void;
}

const MAX_STEPS_DEFAULT = 10;

export class Agent {
  private readonly config: LLMConfig;
  private readonly tools: Tool[];
  private readonly toolMap: Map<string, Tool>;
  private readonly chatFn: typeof chat;

  /** chatFn 仅用于测试时替换真实 LLM，生产调用无需传入 */
  constructor(config: LLMConfig, tools: Tool[], chatFn: typeof chat = chat) {
    this.config = config;
    this.tools = tools;
    this.toolMap = new Map(tools.map((t) => [t.name, t]));
    this.chatFn = chatFn;
  }

  /** 处理一个用户问题，返回最终回答文本 */
  async run(question: string, options: AgentOptions = {}): Promise<string> {
    const maxSteps = options.maxSteps ?? MAX_STEPS_DEFAULT;
    const messages: ChatMessage[] = [
      { role: "system", content: options.systemPrompt ?? "你是一个乐于助人的助手。" },
      { role: "user", content: question },
    ];

    for (let step = 1; step <= maxSteps; step++) {
      // ---- Reason: 模型基于全部历史思考下一步 ----
      const assistant = await this.chatFn(messages, this.tools.map((t) => t.schema), this.config);

      const toolCalls = assistant.tool_calls ?? [];
      const text = assistant.content ?? "";

      // 没有 tool_calls → 模型认为任务完成，返回最终答案
      if (toolCalls.length === 0) {
        options.onStep?.({ text, toolCalls, results: {} }, step);
        return text;
      }

      // ---- Act: 执行每个工具调用，结果作为 Observation ----
      const results: Record<string, string> = {};
      messages.push(assistant); // 保存 assistant 的工具调用请求
      for (const call of toolCalls) {
        const output = await this.executeTool(call);
        results[call.id] = output;
        messages.push({ role: "tool", content: output, tool_call_id: call.id });
      }

      options.onStep?.({ text, toolCalls, results }, step);
    }

    throw new Error(`已达到最大步数 ${maxSteps}，仍未得到最终回答。可调大 maxSteps 后重试。`);
  }

  /** 执行单个工具调用，任何异常都转成文本观察值喂回模型（让它自行纠错） */
  private async executeTool(call: ToolCall): Promise<string> {
    const tool = this.toolMap.get(call.function.name);
    if (!tool) {
      return `错误: 未知工具 "${call.function.name}"`;
    }
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      return `错误: 工具 "${call.function.name}" 的参数不是合法 JSON: ${call.function.arguments}`;
    }
    try {
      const result = await tool.handler(args);
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (err) {
      return `错误: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
