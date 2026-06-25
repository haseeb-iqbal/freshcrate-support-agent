import OpenAI from "openai";
import type { ChatProvider, ChatStreamOptions } from "./types";

const DEFAULT_FAST_MODEL = "gpt-4o-mini";

/** OpenAI-backed chat provider with token streaming. */
export class OpenAIChatProvider implements ChatProvider {
  readonly defaultModel = process.env.CHAT_MODEL_FAST ?? DEFAULT_FAST_MODEL;
  private client: OpenAI;

  constructor(apiKey: string | undefined = process.env.OPENAI_API_KEY) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set — required for chat.");
    }
    this.client = new OpenAI({ apiKey });
  }

  async *streamChat(opts: ChatStreamOptions): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: opts.model ?? this.defaultModel,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? Number(process.env.MAX_OUTPUT_TOKENS ?? 1024),
      temperature: opts.temperature ?? 0.2,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
