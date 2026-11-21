# minimal-agent-loop

一个用 TypeScript 编写的极简 Agent Loop，实现 ReAct（Reason → Act → Observe）循环。
零运行时依赖、无 SDK —— 核心逻辑约 100 行，适合用来理解 agent 的底层工作原理。

> Python 版见 [minimal-agent-loop-py](https://github.com/BinShaw/minimal-agent-loop-py)。

## ReAct 循环

```
            ┌──────────────────────────────────────────┐
            │                                          │
  user ──►  Reason ──► 返回 tool_calls? ──否──► 输出最终答案
            │  ▲                    │
            │  │                  是
            │  │                    ▼
            │  └── Observe ◄── Act（执行工具，结果追加进对话历史）
            └──────────────────────────────────────────┘
```

1. **Reason** — 把完整对话历史（含之前的工具观察）发给 LLM；
2. **Act** — 若模型返回 `tool_calls`，逐个执行工具；
3. **Observe** — 工具结果作为 `tool` 消息追加进历史，回到第 1 步；
4. 模型不再请求工具时，其文本回复即最终答案。

## 快速开始

```bash
npm install
npm run dev   # 交互式对话（开发模式，用 tsx 直接跑 TS）
```

运行前需要设置环境变量，任选一种 OpenAI 兼容服务：

| 服务 | `OPENAI_BASE_URL` | `MODEL` | `OPENAI_API_KEY` |
|---|---|---|---|
| OpenAI（默认） | 可不设 | 可不设 | `sk-...` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-flash` | 你的 key |
| 本地 Ollama | `http://localhost:11434/v1` | `qwen3.8` 等 | 任意非空值，如 `ollama` |

以 DeepSeek 为例，三种 shell 的写法：

```bash
# bash / zsh（macOS、Linux、Git Bash）
export OPENAI_BASE_URL=https://api.deepseek.com/v1
export OPENAI_API_KEY=sk-...
export MODEL=deepseek-flash
```

```powershell
# PowerShell（Windows）
$env:OPENAI_BASE_URL = "https://api.deepseek.com/v1"
$env:OPENAI_API_KEY = "sk-..."
$env:MODEL = "deepseek-flash"
```

```cmd
:: cmd（Windows）
set OPENAI_BASE_URL=https://api.deepseek.com/v1
set OPENAI_API_KEY=sk-...
set MODEL=deepseek-flash
```

也可以先编译再运行。带上 `--enable-source-maps`，报错堆栈会直接指向 `src/*.ts` 而不是编译产物：

```bash
npm run build && node --enable-source-maps dist/cli.js
```

## 一次对话长什么样

```text
你> 现在几点？另外 12 * (3 + 4) 等于多少？
[step 1] 思考: 我需要先获取当前时间。
[step 1] 调用 get_current_time({}) → 2026-11-20T08:00:00.000Z
[step 2] 思考: 接下来计算 12 * (3 + 4)。
[step 2] 调用 calculate({"expression":"12 * (3 + 4)"}) → 84

助手> 当前时间是 2026-11-20T08:00:00.000Z（UTC），12 * (3 + 4) = 84。
```

（示例输出。思考文案、工具调用次数随模型而不同；也可能一轮里同时发起两个调用。）

每一行正好对应循环的一个环节：`思考` 是 Reason，`调用 ...` 是 Act，`→` 后面是 Observe。

## 项目结构

| 文件 | 职责 |
|---|---|
| `src/types.ts` | 纯类型定义（消息、工具调用、工具 schema、配置），无运行时代码 |
| `src/llm.ts` | 与模型通信：`fetch` 直调 Chat Completions API + 环境变量配置 |
| `src/tools.ts` | 工具层：`defineTool` 工厂 + 两个内置工具 |
| `src/agent.ts` | **核心 ReAct 循环**（本项目的主角）|
| `src/cli.ts` | 交互式命令行入口，把每步的思考与工具调用打印出来 |
| `src/agent.test.ts` | 离线测试（假 LLM，不需要 API key）|

## 读代码路线

建议按一次请求的生命周期读，而不是按文件名字典序：

1. `src/cli.ts:30` — 入口：创建 `Agent`，用 `onStep` 把过程打印出来；
2. `src/agent.ts:46` — `run()`：组装 `system` + `user` 两条初始消息；
3. `src/agent.ts:57` — Reason：把历史与工具 schema 一起发给模型；
4. `src/llm.ts:27` — `chat()`：全项目唯一的网络请求，**重点读 `tools` 字段上方的注释**；
5. `src/agent.ts:63` — 分支：没有 `tool_calls` 就返回最终答案，循环结束；
6. `src/agent.ts:73` — Act / Observe：存 assistant 消息 → 执行工具 → 追加 `tool` 消息；
7. `src/agent.ts:91` — `executeTool()`：三种失败如何变成观察值而不是异常；
8. `src/agent.test.ts` — 换一个假 LLM，离线观察同一套循环。

一个常见疑问在这里就能解开：**模型怎么知道有哪些工具可用？** 约定不在 system prompt 里，而在请求体的 `tools` 字段里。`tools` 决定"能不能调、参数长什么样"，system prompt 只影响"要不要调"。

## 内置工具与添加自己的工具

- `calculate` — 数学表达式求值（输入做了字符白名单校验）
- `get_current_time` — 返回当前时间

用 `defineTool` 添加工具，只需关心名字、说明、参数和执行逻辑：

```ts
const weather = defineTool({
  name: "get_weather",
  description: "查询指定城市的天气",
  parameters: {
    type: "object",
    properties: { city: { type: "string", description: "城市名" } },
    required: ["city"],
  },
  handler: async (args) => `${args.city}：晴，26°C`,
});

const agent = new Agent(loadConfig(), [...createDefaultTools(), weather]);
```

`defineTool` 会把这个名字同时填进本地路由 key 和 `schema.function.name`，两者必须一致，工厂帮你省去这处重复。

## 关于安全约束

工具是模型触达真实世界的通道，所以每个工具都该先想"模型可能传什么怪东西进来"：

- `calculate` 用字符白名单过滤表达式，**禁掉字母是关键**——没有字母就拼不出 `constructor`、`globalThis` 之类的标识符，表达式够不到 JS 本身的能力；
- 真实项目请用表达式解析器（如 mathjs）代替 `new Function`，这里只是为了零依赖；
- 如果哪天想加 shell 类工具，同样思路是命令白名单，例如只放行 `/^npm (test|run test)( |$)/` 这类固定前缀，而不是把模型给的字符串直接丢进 `exec`。

另一个相关设计：工具出错时**不要抛异常**，把错误文本作为观察值喂回去，模型才有机会自己修正（见 `executeTool`）。

## 测试

```bash
npm test   # 用脚本化的假 LLM 验证循环逻辑，离线可跑
```

覆盖：

- 多轮工具调用后给出最终回答；
- **对话历史如何逐轮累积**（`assistant` 的 `tool_calls` 与 `tool` 消息靠 `tool_call_id` 配对）；
- 工具抛错 → 错误文本作为观察值回喂，模型仍能收尾；
- 达到 `maxSteps` 上限抛错；
- 未知工具名、非法 JSON 参数各自得到错误观察值，互不影响。

## 代码内使用

```ts
import { Agent } from "./agent.js";
import { loadConfig } from "./llm.js";
import { createDefaultTools } from "./tools.js";

const agent = new Agent(loadConfig(), createDefaultTools());
const answer = await agent.run("现在几点？3 小时后是几点？", {
  maxSteps: 10,
  onStep: (step, n) => console.log(`step ${n}:`, step.toolCalls),
});
```

## License

MIT
