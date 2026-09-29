// Thin chat-completion adapter for the analyst panel. Isolates the LLM
// provider SDK behind one neutral function so the rest of the service
// only deals with chat messages; swapping providers touches this file
// alone.

import LLM from 'z-ai-web-dev-sdk'

export type ChatMessage = { role: 'assistant' | 'user'; content: string }

/** Sends one chat completion and returns the trimmed assistant text. */
export async function createChatCompletion(messages: ChatMessage[]): Promise<string> {
  const client = await LLM.create()
  const completion = await client.chat.completions.create({
    messages,
    thinking: { type: 'disabled' },
  })
  return completion.choices[0]?.message?.content?.trim() ?? ''
}
