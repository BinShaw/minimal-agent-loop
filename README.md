# minimal-agent-loop

一个用 TypeScript 编写的极简 Agent Loop，实现 ReAct（Reason → Act → Observe）循环。
零运行时依赖、无 SDK —— 核心逻辑约 100 行，适合用来理解 agent 的底层工作原理。

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

# 任选一种 OpenAI 兼容服务：
export OPENAI_API_KEY=sk-...                              # 直连 OpenAI
export OPENAI_BASE_URL=https://api.deepseek.com/v1 \      # 或 DeepSeek
       OPENAI_API_KEY=... MODEL=deepseek-chat
export OPENAI_BASE_URL=http://localhost:11434/v1 \        # 或本地 Ollama
       OPENAI_API_KEY=ollama MODEL=qwen2.5

npm run dev   # 交互式对话（开发模式）
npm run build && npm start   # 编译后运行
```

## 项目结构

| 文件 | 职责 |
|---|---|
| `src/types.ts` | 共享类型 + `fetch` 直调 Chat Completions API + 环境变量配置 |
| `src/tools.ts` | 工具层：schema（给模型看）+ handler（真正执行）|
| `src/agent.ts` | **核心 ReAct 循环**（本项目的主角）|
| `src/cli.ts` | 交互式命令行入口 |
| `src/agent.test.ts` | 离线冒烟测试（mock LLM，不需要 API key）|

## 内置工具示例

- `calculate` — 数学表达式求值（输入做了字符白名单校验）
- `get_current_time` — 返回当前时间

添加自己的工具只需定义 `{ name, schema, handler }` 传给 `Agent` 构造函数。

## 测试

```bash
npm test   # 用脚本化的假 LLM 验证循环逻辑，离线可跑
```

覆盖：多轮工具调用、工具报错回喂、步数上限、未知工具 / 非法参数。

## 代码内使用

```ts
import { Agent } from "./agent.js";
import { loadConfig } from "./types.js";
import { createDefaultTools } from "./tools.js";

const agent = new Agent(loadConfig(), createDefaultTools());
const answer = await agent.run("现在几点？3 小时后是几点？", {
  maxSteps: 10,
  onStep: (step, n) => console.log(`step ${n}:`, step.toolCalls),
});
```

## License

MIT
