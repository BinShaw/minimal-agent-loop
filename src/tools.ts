/**
 * 工具层：定义 + 执行，故意保持极简。
 * 每个工具 = schema（给模型看的 JSON Schema）+ handler（真正执行的函数）。
 */
import type { ToolSchema } from "./types.js";

export interface Tool {
  name: string;
  schema: ToolSchema;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/** 运行时执行命令（demo 里 agent 用它来跑 npm script） */
async function runCommand(command: string, timeoutMs = 60_000): Promise<string> {
  const { exec } = await import("node:child_process");
  return new Promise((resolve) => {
    exec(
      command,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve(`exit code ${err.code ?? "?"}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
        } else {
          resolve(stdout + (stderr ? `\nstderr:\n${stderr}` : ""));
        }
      }
    );
  });
}

/** 命令白名单，只允许跑测试相关命令，防止 prompt injection 下跑任意命令 */
const ALLOWED_COMMANDS = [/^npm (test|run test)( |$)/, /^node --test( |$)/, /^npx tsx .+\.test\.ts$/];

function assertAllowed(command: string): void {
  if (!ALLOWED_COMMANDS.some((re) => re.test(command))) {
    throw new Error(`命令不在白名单内: ${command}`);
  }
}

/** 汇总错误信息，供 tool 消息返回给模型 */
function captureStack(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

export function createDefaultTools(): Tool[] {
  return [
    {
      name: "calculate",
      schema: {
        type: "function",
        function: {
          name: "calculate",
          description: "计算一个数学表达式并返回结果",
          parameters: {
            type: "object",
            properties: {
              expression: { type: "string", description: "例如 2 + 3 * 4" },
            },
            required: ["expression"],
          },
        },
      },
      handler: async (args) => {
        const expression = String(args.expression ?? "").trim();
        // 只放行纯数学字符，防止借表达式执行任意代码
        if (!/^[-+*/%().,\d\s]+$/.test(expression)) {
          throw new Error("表达式含非法字符，只支持数字和 + - * / % ( )");
        }
        const result = new Function(`"use strict"; return (${expression});`)();
        if (typeof result !== "number" || !Number.isFinite(result)) {
          throw new Error(`无法求值: ${expression}`);
        }
        return result;
      },
    },
    {
      name: "get_current_time",
      schema: {
        type: "function",
        function: {
          name: "get_current_time",
          description: "获取当前时间",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      },
      handler: () => new Date().toISOString(),
    },
  ];
}

export { runCommand, assertAllowed, captureStack };
