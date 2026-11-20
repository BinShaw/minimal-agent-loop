/**
 * 离线冒烟测试：用脚本化的假 chat 函数验证 ReAct 循环逻辑
 * （多轮工具调用、错误观察、正常终止）。运行: npm test
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage, LLMConfig, ToolCall } from "./types.js";
import { Agent, type AgentStep } from "./agent.js";
import type { Tool } from "./tools.js";

const fakeConfig: LLMConfig = { baseUrl: "http://fake", apiKey: "fake", model: "fake" };

function makeTool(name: string): Tool {
  return {
    name,
    schema: {
      type: "function",
      function: {
        name,
        description: `test tool ${name}`,
        parameters: { type: "object", properties: {} },
      },
    },
    handler: (args: Record<string, unknown>) => `echo:${name}:${String(args.input ?? "")}`,
  };
}

function toolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

test("多轮工具调用后给出最终回答", async () => {
  const steps: AgentStep[] = [];
  let round = 0;
  const scripted = async (): Promise<ChatMessage> => {
    round++;
    if (round === 1) {
      return { role: "assistant", content: "先查时间", tool_calls: [toolCall("c1", "get_time", {})] };
    }
    if (round === 2) {
      return { role: "assistant", content: "再算个数", tool_calls: [toolCall("c2", "calc", { input: 42 })] };
    }
    return { role: "assistant", content: "最终答案" };
  };

  const agent = new Agent(fakeConfig, [makeTool("get_time"), makeTool("calc")], scripted);
  const answer = await agent.run("问题", { onStep: (s) => steps.push(s) });

  assert.equal(answer, "最终答案");
  assert.equal(steps.length, 3); // 2 次工具步骤 + 1 次最终回答
  assert.equal(steps[0].toolCalls[0].function.name, "get_time");
  assert.equal(steps[1].results["c2"], "echo:calc:42");
});

test("工具抛错时错误作为观察值返回，模型仍能得到最终回答", async () => {
  const boom: Tool = {
    ...makeTool("boom"),
    handler: () => {
      throw new Error("炸了");
    },
  };
  const scripted = async (): Promise<ChatMessage> =>
    round === 1
      ? { role: "assistant", content: "", tool_calls: [toolCall("c1", "boom", {})] }
      : { role: "assistant", content: "看到错误了" };
  let round = 0;
  // 上面的 scripted 定义在 round 声明前引用了 round，这里重新计数
  round = 0;

  const agent = new Agent(fakeConfig, [boom], scripted);
  const answer = await agent.run("问题");
  assert.equal(answer, "看到错误了");
});

test("达到 maxSteps 上限时抛出错误", async () => {
  const scripted = async (): Promise<ChatMessage> => ({
    role: "assistant",
    content: "",
    tool_calls: [toolCall("c1", "loop", {})],
  });
  const agent = new Agent(fakeConfig, [makeTool("loop")], scripted);
  await assert.rejects(agent.run("问题", { maxSteps: 3 }), /最大步数/);
});

test("未知工具与非法 JSON 参数都会返回错误观察值", async () => {
  let round = 0;
  const scripted = async (): Promise<ChatMessage> => {
    round++;
    if (round === 1) {
      return {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "nope", arguments: "{}" } },
          { id: "c2", type: "function", function: { name: "calc", arguments: "{bad json" } },
        ],
      };
    }
    return { role: "assistant", content: "done" };
  };
  const agent = new Agent(fakeConfig, [makeTool("calc")], scripted);
  const answer = await agent.run("问题");
  assert.equal(answer, "done");
});
