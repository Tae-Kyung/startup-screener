import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_CRITERIA, DEFAULT_PROMPT_TEMPLATE } from './prompt-defaults';

export interface CheckpointItem {
  criterion: string;  // 심사 항목 (예: 업력 확인, 소재지 확인)
  document: string;   // 확인한 서류명 (예: 참여신청서 2p, 사업계획서)
  finding: string;    // 서류에서 확인된 구체적 내용
  result: '적합' | '부적합' | '확인불가';
}

export interface ExtractedApplicantData {
  name?: string;
  enterpriseName?: string;
  historyType?: string;
  locationHeadquarters?: string;
  residence?: string;
  birthDate?: string;
}

export interface LLMResult {
  status: 'Pass' | 'Fail' | 'Pending';
  reasoning: string;
  checkpoints?: CheckpointItem[];
  extractedData?: ExtractedApplicantData;
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

export interface PDFAnalysisContext {
  taskNumber: string;
  historyType?: string;
  locationHeadquarters?: string;
  residence?: string;
  birthDate?: string;
}

/**
 * PDF 서류(신청서, 사업계획서 등)를 OpenAI Responses API로 직접 분석합니다.
 * base64 인코딩된 PDF를 인라인으로 전달하므로 별도 파일 업로드가 불필요합니다.
 */
export async function analyzePDFsWithOpenAI(
  pdfFiles: Array<{ name: string; base64: string } | { name: string; fileId: string }>,
  context: PDFAnalysisContext,
  criteria?: string,
  model: string = 'gpt-4o'
): Promise<LLMResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { status: 'Pending', reasoning: 'OPENAI_API_KEY가 설정되지 않았습니다.' };
  }

  const criteriaText = criteria || DEFAULT_CRITERIA;

  const prompt = `당신은 창업 지원 자격 요건 검토 전문가입니다.
첨부된 PDF 서류(신청서, 사업계획서, 기타 제출 서류)를 직접 읽고 두 가지 작업을 수행하세요.

[작업 1] 지원자 기본 정보를 서류에서 추출하세요.
[작업 2] 아래 [심사 기준]에 따라 적격성을 판단하세요.

[심사 기준]
${criteriaText}

[참고 데이터 - 과제번호 ${context.taskNumber}]
- 창업 유형: ${context.historyType || '서류 확인 필요'}
- 본점 소재지: ${context.locationHeadquarters || '서류 확인 필요'}
- 거주지: ${context.residence || '서류 확인 필요'}
- 생년월일: ${context.birthDate || '서류 확인 필요'}

[결과 분류 지침]
- Pass: 서류 검토 결과 모든 요건 충족
- Fail: 서류에서 명확한 부적격 사유 확인
- Pending: 서류가 불명확하거나 추가 확인이 필요한 경우

[출력 형식] 반드시 아래 JSON만 출력하세요 (다른 텍스트 금지):
{
  "extractedData": {
    "name": "대표자 성명 (서류에서 확인, 없으면 null)",
    "enterpriseName": "기업명 또는 기관명 (없으면 null)",
    "historyType": "창업 유형 (예비창업자/창업3년이하/창업7년이하 등, 없으면 null)",
    "locationHeadquarters": "본점 소재지 전체 주소 (없으면 null)",
    "residence": "대표자 거주지 주소 (없으면 null)",
    "birthDate": "생년월일 YYYY-MM-DD 형식 (없으면 null)"
  },
  "status": "Pass | Fail | Pending",
  "reasoning": "종합 판단 근거 (2~3문장, 한국어)",
  "checkpoints": [
    {
      "criterion": "심사 항목명 (예: 업력, 소재지, 청년 여부 등)",
      "document": "확인한 서류명과 위치 (예: 참여신청서 3페이지, 사업계획서 표지)",
      "finding": "서류에서 직접 확인한 구체적 내용 (날짜, 주소, 수치 등)",
      "result": "적합 | 부적합 | 확인불가"
    }
  ]
}`;

  const contentParts: Array<{ type: string; [key: string]: unknown }> = [
    { type: 'input_text', text: prompt },
  ];

  for (const pdf of pdfFiles) {
    if ('fileId' in pdf) {
      contentParts.push({
        type: 'input_file',
        file_id: (pdf as { name: string; fileId: string }).fileId,
      });
    } else {
      contentParts.push({
        type: 'input_file',
        filename: pdf.name,
        file_data: `data:application/pdf;base64,${(pdf as { name: string; base64: string }).base64}`,
      });
    }
  }

  try {
    // OpenAI Responses API (SDK v5+) - PDF 인라인 전송 지원
    const response = await (openai as any).responses.create({
      model,
      input: [{ role: 'user', content: contentParts }],
      text: { format: { type: 'json_object' } },
    });

    const text: string = response.output_text || '';
    // 중첩 JSON (checkpoints 배열 포함)을 올바르게 추출하기 위해 greedy match
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 응답을 파싱할 수 없습니다.');
    return JSON.parse(jsonMatch[0]) as LLMResult;
  } catch (error) {
    console.error('PDF Analysis Error:', error);
    return {
      status: 'Pending',
      reasoning: `PDF 분석 중 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}. 수동 확인이 필요합니다.`,
    };
  }
}
