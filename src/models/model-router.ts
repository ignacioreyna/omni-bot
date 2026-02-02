import { query } from '@anthropic-ai/claude-agent-sdk';

export type ModelType = 'haiku' | 'sonnet' | 'opus';

const HAIKU_MODEL = 'haiku';

const SYSTEM_PROMPT = `You are a task complexity analyzer. Given a user's request, determine which Claude model is best suited:

- haiku: Simple questions, quick lookups, short answers, basic tasks
- sonnet: Code modifications, bug fixes, moderate complexity, typical development tasks
- opus: Complex architecture, system design, multi-file refactoring, deep analysis, planning

Respond with ONLY the model name: haiku, sonnet, or opus`;

export async function analyzeAndSelectModel(message: string): Promise<ModelType> {
  try {
    const response = await query({
      prompt: `Analyze this task and choose the appropriate model:\n\n${message}`,
      options: {
        model: HAIKU_MODEL,
        maxTurns: 1,
        tools: [],
        systemPrompt: SYSTEM_PROMPT,
        persistSession: false,
      },
    });

    let result = '';
    for await (const event of response) {
      if (event.type === 'result' && event.subtype === 'success') {
        result = event.result.toLowerCase().trim();
        break;
      }
    }

    if (result.includes('opus')) return 'opus';
    if (result.includes('haiku')) return 'haiku';
    return 'sonnet'; // Default fallback
  } catch (error) {
    console.error('[Model Router] Analysis failed, defaulting to sonnet:', error);
    return 'sonnet';
  }
}
