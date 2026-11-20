/**
 * 工具层：定义 + 执行，故意保持极简。
 * 每个工具 = schema（给模型看的 JSON Schema）+ handler（真正执行的函数）。
 */
import type { ToolSchema } from "./types.js";

export interface Tool {
  /** 本地路由 key，Agent 用它找到要执行的 handler */
  name: string;
  /** 发给模型的线上协议，其 function.name 与上面的 name 是同一个名字 */
  schema: ToolSchema;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolSchema["function"]["parameters"];
  handler: Tool["handler"];
}

/**
 * 组装一个工具，把 JSON Schema 的嵌套样板收进工厂内部。
 * name 同时填入本地路由 key 和 schema.function.name，避免两处手写不一致。
 */
export function defineTool(def: ToolDefinition): Tool {
  return {
    name: def.name,
    schema: {
      type: "function",
      function: {
        name: def.name,
        description: def.description,
        parameters: def.parameters,
      },
    },
    handler: def.handler,
  };
}

export function createDefaultTools(): Tool[] {
  return [
    defineTool({
      name: "calculate",
      description: "计算一个数学表达式并返回结果",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "例如 2 + 3 * 4" },
        },
        required: ["expression"],
      },
      handler: (args) => {
        const expression = String(args.expression ?? "").trim();
        // 白名单只放行数学字符。禁掉字母是安全的关键：没有字母就拼不出任何
        // 标识符（constructor、globalThis 等），表达式便够不到 JS 本身的能力。
        if (!/^[-+*/%().,\d\s]+$/.test(expression)) {
          throw new Error("表达式含非法字符，只支持数字和 + - * / % ( )");
        }
        // 教学简化：真实项目请改用表达式解析器（如 mathjs）。
        // 这里为了零依赖采用「白名单 + Function」，绝不能套用到未过滤的输入上。
        const result = new Function(`"use strict"; return (${expression});`)();
        if (typeof result !== "number" || !Number.isFinite(result)) {
          throw new Error(`无法求值: ${expression}`);
        }
        return result;
      },
    }),
    defineTool({
      name: "get_current_time",
      description: "获取当前时间",
      parameters: {
        type: "object",
        properties: {},
      },
      handler: () => new Date().toISOString(),
    }),
  ];
}
