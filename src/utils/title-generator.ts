import { query } from '@anthropic-ai/claude-agent-sdk';

const HAIKU_MODEL = 'haiku';

/**
 * Generate a session title from the first user message using Claude Haiku.
 * Returns a concise title (max 50 chars).
 */
export async function generateSessionTitle(firstMessage: string): Promise<string> {
  const prompt = `Generate a concise title (max 50 characters) for a chat session that starts with this message. Return ONLY the title, no quotes, no explanation.

Message: "${firstMessage.slice(0, 500)}"`;

  try {
    const response = await query({
      prompt,
      options: {
        model: HAIKU_MODEL,
        maxTurns: 1,
        tools: [], // No tools needed for title generation
        systemPrompt: 'You are a title generator. Output only a short, descriptive title. No markdown, no quotes, no explanation.',
        persistSession: false, // Don't save this ephemeral query
      },
    });

    let title = '';
    for await (const message of response) {
      if (message.type === 'result' && message.subtype === 'success') {
        title = message.result.trim();
        break;
      }
    }

    // Fallback if no result
    if (!title) {
      title = generateFallbackTitle(firstMessage);
    }

    // Ensure max length
    return title.slice(0, 100);
  } catch (error) {
    console.error('[TitleGenerator] Error generating title:', error);
    return generateFallbackTitle(firstMessage);
  }
}

/**
 * Fallback title generation from first message words.
 */
function generateFallbackTitle(message: string): string {
  const words = message.trim().split(/\s+/).slice(0, 6);
  let title = words.join(' ');
  if (title.length > 50) {
    title = title.slice(0, 47) + '...';
  }
  return title || 'New Session';
}
