/**
 * 核心 ReAct 循环：推理（Reason）→ 行动（Act）→ 观察（Observe），循环直到模型给出最终回答。
 *
 * 一轮迭代：
 *   1. Reason: 把整个对话（含之前的工具观察）发给 LLM
 *   2. Act:    若模型返回 tool_calls → 执行工具，把结果作为 tool 消息追加进历史（Observe）
 *   3.         若无 tool_calls → 模型已得出答案，循环结束
 */
import type { ChatMessage, LLMConfig, ToolCall } from "./types.js";
import { chat } from "./llm.js";
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

    // 这个循环只有一个正常出口：模型不再索要工具时，在循环内部 return。
    // 如果 for 自然跑完还没返回，说明模型一直在要工具（可能陷入死循环），属于异常。
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
      // 必须先把 assistant 的 tool_calls 消息存进历史，再追加 tool 结果。
      // 少了这一步，下一轮请求里 tool 消息的 tool_call_id 就找不到对应的调用，
      // 服务端会直接报 400（这是自己复现 ReAct 时最常踩的坑）。
      messages.push(assistant);
      for (const call of toolCalls) {
        const output = await this.executeTool(call);
        results[call.id] = output;
        messages.push({ role: "tool", content: output, tool_call_id: call.id });
      }

      options.onStep?.({ text, toolCalls, results }, step);
    }

    throw new Error(`已达到最大步数 ${maxSteps}，仍未得到最终回答。可调大 maxSteps 后重试。`);
  }

  /**
   * 执行单个工具调用。
   * 核心原则：任何异常都转成文本观察值喂回模型，而不是抛出去。
   * 错误成为观察值，模型才有机会在下一轮自行修正；抛出去就等于替模型终止了对话。
   */
  private async executeTool(call: ToolCall): Promise<string> {
    // 情况 1：模型幻觉出未注册的工具名，如实告诉它"没有这个工具"
    const tool = this.toolMap.get(call.function.name);
    if (!tool) {
      return `错误: 未知工具 "${call.function.name}"`;
    }
    let args: Record<string, unknown>;
    try {
      // 无参数工具有时返回空字符串，按 {} 处理
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      // 情况 2：参数不是合法 JSON，把原始参数一并回喂，便于它照着改正重试
      return `错误: 工具 "${call.function.name}" 的参数不是合法 JSON: ${call.function.arguments}`;
    }
    try {
      const result = await tool.handler(args);
      // 无论工具返回什么，最终都要变成字符串才能进入对话历史
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (err) {
      // 情况 3：工具自身执行失败（业务错误），同样只作为观察值，不中断循环
      return `错误: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
