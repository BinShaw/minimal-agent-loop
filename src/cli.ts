/**
 * CLI 入口：加载配置和工具，进入交互式问答循环。
 * 用法: npm run dev  或  node dist/cli.js
 */
import readline from "node:readline/promises";
import { Agent } from "./agent.js";
import { loadConfig } from "./llm.js";
import { createDefaultTools } from "./tools.js";

const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

async function main() {
  const config = loadConfig();
  const agent = new Agent(config, createDefaultTools());

  console.log(`${CYAN}minimal-agent-loop${RESET}  model=${config.model}  baseUrl=${config.baseUrl}`);
  console.log(`${DIM}输入问题开始对话，Ctrl+C 退出。${RESET}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  while (true) {
    const question = (await rl.question(`${YELLOW}你>${RESET} `)).trim();
    if (!question) continue;
    if (question === "exit" || question === "quit") break;

    try {
      const answer = await agent.run(question, {
        onStep: (step, n) => {
          // 最后一步没有工具调用，其 text 就是最终答案，交给下方统一打印
          if (step.toolCalls.length === 0) return;
          // Reason：打印模型的思考文本，ReAct 的"想"也应该看得见
          if (step.text) {
            console.log(`${DIM}[step ${n}] 思考: ${step.text}${RESET}`);
          }
          // Act + Observe：调用了哪个工具、参数是什么、观察到了什么
          for (const call of step.toolCalls) {
            const preview = step.results[call.id]?.slice(0, 200) ?? "";
            console.log(
              `${DIM}[step ${n}] 调用 ${call.function.name}(${call.function.arguments}) → ${preview}${RESET}`
            );
          }
        },
      });
      console.log(`\n${CYAN}助手>${RESET} ${answer}\n`);
    } catch (err) {
      console.error(`\n${YELLOW}出错:${RESET} ${err instanceof Error ? err.message : err}\n`);
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
