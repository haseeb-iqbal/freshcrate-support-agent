import OpenAI from "openai";
import type {
  AgentMessage,
  AgentStreamEvent,
  AgentTurnOptions,
  ChatProvider,
  ToolDefinition,
} from "./types";

const DEFAULT_FAST_MODEL = "gpt-4o-mini";

function toOpenAIMessages(
  messages: AgentMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((m): OpenAI.Chat.ChatCompletionMessageParam => {
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }
          : {}),
      };
    }
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    }
    return { role: m.role, content: m.content };
  });
}

function toOpenAITools(tools: ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** OpenAI-backed chat provider with streaming + function calling. */
export class OpenAIChatProvider implements ChatProvider {
  readonly defaultModel = process.env.CHAT_MODEL_FAST ?? DEFAULT_FAST_MODEL;
  private client: OpenAI;

  constructor(apiKey: string | undefined = process.env.OPENAI_API_KEY) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set — required for chat.");
    }
    this.client = new OpenAI({ apiKey });
  }

  async *streamAgentTurn(opts: AgentTurnOptions): AsyncIterable<AgentStreamEvent> {
    const stream = await this.client.chat.completions.create({
      model: opts.model ?? this.defaultModel,
      messages: toOpenAIMessages(opts.messages),
      tools: opts.tools?.length ? toOpenAITools(opts.tools) : undefined,
      max_tokens: opts.maxTokens ?? Number(process.env.MAX_OUTPUT_TOKENS ?? 1024),
      temperature: opts.temperature ?? 0.2,
      stream: true,
    });

    // Tool-call fragments arrive across many chunks keyed by index; accumulate.
    const acc = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        yield { type: "text", value: delta.content };
      }

      for (const tc of delta.tool_calls ?? []) {
        const cur = acc.get(tc.index) ?? { id: "", name: "", arguments: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        acc.set(tc.index, cur);
      }
    }

    if (acc.size > 0) {
      yield { type: "tool_calls", value: [...acc.values()] };
    }
  }
}
