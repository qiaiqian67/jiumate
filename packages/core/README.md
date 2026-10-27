# @jadelau/core

The JiuMate SDK and execution engine: the ReAct loop (`context_engine`), the OmniMessage protocol, the LLM / Environment interface contracts, Agent State and append-only Traces.

The engine speaks only OmniMessage and delegates everything else through two swappable interfaces — `LLMInterface` (models, via the [`@jadelau/agenthub`](https://www.npmjs.com/package/@jadelau/agenthub) gateway) and `EnvironmentInterface` (tool execution). The SDK caller is the Human boundary: one entry point, `session.run`, streams the whole loop.

```ts
import { createAgent, isCompleteModelMessage, userText } from "@jadelau/core";

const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });

for await (const output of session.run([userText("Create hello.txt containing hi")], {
  approve: async () => "allow", // per-tool-call approval
})) {
  if (isCompleteModelMessage(output) && output.payload.type === "text") {
    console.log(output.payload.text);
  }
}
```

A single `run` drives a complete Task: streaming output, per-call approvals, concurrent tool execution, interrupt carry-over, automatic reconnect and context compaction. State lives under `~/.jiumate/data` (`JIUMATE_HOME`); every Session restores fully from its Trace.

## Documentation

- [Architecture](https://jiumate.ooo/docs/architecture)
- [The OmniMessage Protocol](https://jiumate.ooo/docs/omni-message)
- [Core Interfaces](https://jiumate.ooo/docs/interfaces)
- [The Agent Loop](https://jiumate.ooo/docs/agent-loop)
- [Sessions & Traces](https://jiumate.ooo/docs/sessions-and-traces)

## Development

```bash
pnpm --filter @jadelau/core build       # tsup → dist/ (exports point at dist)
pnpm --filter @jadelau/core typecheck
pnpm --filter @jadelau/core test
pnpm test:e2e                                       # live-model e2e (needs DEEPSEEK_API_KEY)
```

Part of [JiuMate](https://github.com/qiaiqian67/jiumate) · Apache-2.0
