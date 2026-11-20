/**
 * 离线冒烟测试：用脚本化的假 chat 函数验证 ReAct 循环逻辑
 * （多轮工具调用、历史累积、错误观察、正常终止）。运行: npm test
 *
 * 关键手法：Agent 构造器的第三个参数可以替换"问模型"这件事，
 * 所以不需要 API key 就能测试整个循环。
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage, LLMConfig, ToolCall } from "./types.js";
import { Agent, type AgentStep } from "./agent.js";
import { defineTool, type Tool } from "./tools.js";

const fakeConfig: LLMConfig = { baseUrl: "http://fake", apiKey: "fake", model: "fake" };

/**
 * 假 LLM：第 n 次被调用就返回剧本里的第 n 条消息。
 * 剧本用完后一直重复最后一条（最终回答 → 正常结束；工具调用 → 可用来模拟死循环）。
 */
function scriptedChat(...replies: ChatMessage[]) {
  let i = 0;
  return async () => replies[Math.min(i++, replies.length - 1)];
}

function makeTool(name: string): Tool {
  return defineTool({
    name,
    description: `test tool ${name}`,
    parameters: { type: "object", properties: {} },
    handler: (args) => `echo:${name}:${String(args.input ?? "")}`,
  });
}

function toolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

/** 一条带工具调用的 assistant 消息：循环会继续 */
function toolRequest(text: string, ...calls: ToolCall[]): ChatMessage {
  return { role: "assistant", content: text, tool_calls: calls };
}

/** 一条纯文本的 assistant 消息：没有 tool_calls，循环到此结束 */
function textReply(text: string): ChatMessage {
  return { role: "assistant", content: text };
}

test("多轮工具调用后给出最终回答", async () => {
  const steps: AgentStep[] = [];
  const agent = new Agent(
    fakeConfig,
    [makeTool("get_time"), makeTool("calc")],
    scriptedChat(
      toolRequest("先查时间", toolCall("c1", "get_time", {})),
      toolRequest("再算个数", toolCall("c2", "calc", { input: 42 })),
      textReply("最终答案")
    )
  );

  const answer = await agent.run("问题", { onStep: (s) => steps.push(s) });

  assert.equal(answer, "最终答案");
  assert.equal(steps.length, 3); // 2 次工具步骤 + 1 次最终回答
  assert.equal(steps[0].text, "先查时间"); // Reason 也会传给 onStep
  assert.equal(steps[0].toolCalls[0].function.name, "get_time");
  assert.equal(steps[1].results["c2"], "echo:calc:42");
  assert.deepEqual(steps[2].toolCalls, []); // 最后一步没有工具调用
});

test("对话历史随循环累积：assistant 的工具调用与 tool 观察值成对出现", async () => {
  const snapshots: ChatMessage[][] = [];
  const replies = [toolRequest("先算个数", toolCall("c1", "calc", { input: 1 })), textReply("算完了")];
  let i = 0;
  // 除了按剧本回复，还把每轮发出去的历史拍个快照，看看循环到底给模型看了什么
  const recordingChat = async (messages: ChatMessage[]): Promise<ChatMessage> => {
    snapshots.push(structuredClone(messages));
    return replies[Math.min(i++, replies.length - 1)];
  };

  const agent = new Agent(fakeConfig, [makeTool("calc")], recordingChat);
  await agent.run("1+1 等于几");

  assert.equal(snapshots.length, 2); // 工具一轮 + 最终回答一轮
  assert.deepEqual(
    snapshots[0].map((m) => m.role),
    ["system", "user"]
  );
  assert.deepEqual(
    snapshots[1].map((m) => m.role),
    ["system", "user", "assistant", "tool"]
  );

  const [, , assistantMsg, toolMsg] = snapshots[1];
  assert.equal(assistantMsg.tool_calls?.[0].id, "c1");
  // tool 消息靠 tool_call_id 与上面的调用配对；缺了 assistant 那条，API 会报 400
  assert.equal(toolMsg.tool_call_id, "c1");
  assert.equal(toolMsg.content, "echo:calc:1");
});

test("工具抛错时错误作为观察值返回，模型仍能得到最终回答", async () => {
  const steps: AgentStep[] = [];
  const boom = defineTool({
    name: "boom",
    description: "总是失败",
    parameters: { type: "object", properties: {} },
    handler: () => {
      throw new Error("炸了");
    },
  });
  const agent = new Agent(
    fakeConfig,
    [boom],
    scriptedChat(toolRequest("", toolCall("c1", "boom", {})), textReply("看到错误了"))
  );

  const answer = await agent.run("问题", { onStep: (s) => steps.push(s) });

  assert.equal(answer, "看到错误了");
  // 关键：真的执行过一次工具，而不是第一轮就直接收尾
  assert.equal(steps.length, 2);
  assert.match(steps[0].results["c1"], /炸了/);
});

test("达到 maxSteps 上限时抛出错误", async () => {
  // 剧本只有一条工具调用消息，之后每次都会重复它，模拟模型陷入死循环
  const agent = new Agent(
    fakeConfig,
    [makeTool("loop")],
    scriptedChat(toolRequest("", toolCall("c1", "loop", {})))
  );
  await assert.rejects(agent.run("问题", { maxSteps: 3 }), /最大步数/);
});

test("未知工具与非法 JSON 参数都会返回错误观察值", async () => {
  const steps: AgentStep[] = [];
  const agent = new Agent(
    fakeConfig,
    [makeTool("calc")],
    scriptedChat(
      toolRequest(
        "",
        { id: "c1", type: "function", function: { name: "nope", arguments: "{}" } },
        { id: "c2", type: "function", function: { name: "calc", arguments: "{bad json" } }
      ),
      textReply("done")
    )
  );

  const answer = await agent.run("问题", { onStep: (s) => steps.push(s) });

  assert.equal(answer, "done");
  assert.match(steps[0].results["c1"], /未知工具 "nope"/);
  assert.match(steps[0].results["c2"], /不是合法 JSON/);
  // 同一轮里每个失败的调用都各自得到观察值，互不影响
  assert.equal(Object.keys(steps[0].results).length, 2);
});
