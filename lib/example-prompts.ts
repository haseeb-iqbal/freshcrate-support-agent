/**
 * The suggested questions offered on an empty chat.
 *
 * Shared rather than inlined in the UI because MOCK_LLM demo mode matches on the
 * exact question text: a chip whose wording has no mock script replies "(mock)
 * No script for this input", which makes the demo look broken on the very first
 * click. lib/llm/mock-scripts.test.ts asserts every prompt here has a script.
 */
export const EXAMPLE_PROMPTS = [
  "Where's my latest order?",
  "Show me my order history",
  "Pause my subscription for 2 weeks",
  "My last box arrived damaged — I'd like a refund",
];
