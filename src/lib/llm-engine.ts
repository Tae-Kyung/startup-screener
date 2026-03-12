import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_CRITERIA, DEFAULT_PROMPT_TEMPLATE } from './prompt-defaults';

export interface LLMResult {
  status: 'Pass' | 'Fail' | 'Pending';
  reasoning: string;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Performs a real LLM check using OpenAI or Claude.
 * Defaults to OpenAI if both are present, or falls back to whichever is available.
 */
export async function simulateLLMCheck(
  applicantName: string,
  historyType: string,
  locationHeadquarters: string,
  residence: string,
  birthDate: string,
  criteria?: string,
  customPrompt?: string,
  modelSelection: string = 'gpt-4o'
): Promise<LLMResult> {
  // 개인정보보호: 성명은 LLM에 전달하지 않음 (심사 판단에 불필요)
  // 프롬프트 템플릿의 플레이스홀더를 실제 값으로 치환
  const template = customPrompt || DEFAULT_PROMPT_TEMPLATE;
  const finalPrompt = template
    .replace(/\{criteria\}/g, criteria || DEFAULT_CRITERIA)
    .replace(/\{name\}/g, '지원자')
    .replace(/\{type\}/g, historyType)
    .replace(/\{location\}/g, locationHeadquarters)
    .replace(/\{residence\}/g, residence)
    .replace(/\{birthDate\}/g, birthDate);

  try {
    // Model Selection Logic
    const isClaude = modelSelection.toLowerCase().includes('claude');

    if (isClaude && process.env.ANTHROPIC_API_KEY) {
      const response = await anthropic.messages.create({
        model: modelSelection === 'claude' ? 'claude-3-5-sonnet-20240620' : modelSelection,
        max_tokens: 1024,
        messages: [{ role: 'user', content: finalPrompt }],
      });

      const content = ('text' in response.content[0]) ? response.content[0].text : '';
      if (content) {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        return JSON.parse(jsonMatch ? jsonMatch[0] : content) as LLMResult;
      }
    } else if (process.env.OPENAI_API_KEY) {
      const response = await openai.chat.completions.create({
        model: modelSelection === 'chatgpt' ? 'gpt-4o' : modelSelection,
        messages: [{ role: 'user', content: finalPrompt }],
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0].message.content;
      if (content) {
        return JSON.parse(content) as LLMResult;
      }
    }

    throw new Error(`Model ${modelSelection} requested but corresponding API key is missing.`);
  } catch (error) {
    console.error('LLM Check Error:', error);
    return {
      status: 'Pending',
      reasoning: `LLM API 호출 중 오류가 발생했습니다: ${error instanceof Error ? error.message : 'Unknown error'}. 관리자의 수동 확인이 필요합니다.`
    };
  }
}
