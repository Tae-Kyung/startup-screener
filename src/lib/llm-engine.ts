import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

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
  const defaultCriteria = `
1. 업력: 예비창업자 또는 창업 7년 이내 기업이어야 함. (history_type 확인)
2. 지역: 
   - 기창업자: 본점 소재지가 충청권(대전, 세종, 충북, 충남)이어야 함. (location_headquarters 확인)
   - 예비창업자: 신청자 거주지가 충청권이어야 함. (residence 확인)
`;

  // Construct the criteria-based prompt if no template is provided
  // 개인정보보호: 성명은 LLM에 전달하지 않음 (심사 판단에 불필요)
  const criteriaPrompt = `
당신은 창업 지원 자격 요건 검토 전문가입니다.
제공된 지원자 데이터와 아래의 [심사 기준]을 바탕으로 적격성을 판단하고 근거를 설명하세요.

[심사 기준]
${criteria || defaultCriteria}

[결과 분류 지침]
- Pass: 모든 요건 충족
- Fail: 명확한 부적격 사유 발견
- Pending: 데이터가 모호하여 사람의 추가 검토가 필요함

[입력 데이터]
- 창업 유형: ${historyType}
- 본점 소재지: ${locationHeadquarters}
- 거주지: ${residence}
- 생년월일: ${birthDate}

[출력 형식]
반드시 아래 JSON 형식으로만 답변하세요:
{
  "status": "Pass | Fail | Pending",
  "reasoning": "판단 근거에 대한 상세 설명 (한국어)"
}
`;

  // If customPrompt is provided, it might the full template. 
  // For simplicity, we'll assume the user wants to keep the data injection but customize the instructions.
  // Or they can provide a full template with placeholders. 
  // Let's support simple string replacement for now.
  let finalPrompt = customPrompt || criteriaPrompt;
  if (customPrompt) {
    // 커스텀 프롬프트 변수 치환 ({name} 포함 시 '지원자'로 마스킹)
    finalPrompt = finalPrompt
      .replace(/\{name\}/g, '지원자')
      .replace(/\{type\}/g, historyType)
      .replace(/\{location\}/g, locationHeadquarters)
      .replace(/\{residence\}/g, residence)
      .replace(/\{birthDate\}/g, birthDate)
      .replace(/\{criteria\}/g, criteria || defaultCriteria);
  }

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
