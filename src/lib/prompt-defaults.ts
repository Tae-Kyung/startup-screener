export const DEFAULT_CRITERIA = `1. 업력: 예비창업자 또는 창업 7년 이내 기업이어야 함. (history_type 확인)
2. 지역:
   - 기창업자: 본점 소재지가 충청권(대전, 세종, 충북, 충남)이어야 함. (location_headquarters 확인)
   - 예비창업자: 신청자 거주지가 충청권이어야 함. (residence 확인)`;

export const DEFAULT_PROMPT_TEMPLATE = `당신은 창업 지원 자격 요건 검토 전문가입니다.
제공된 지원자 데이터와 아래의 [심사 기준]을 바탕으로 적격성을 판단하고 근거를 설명하세요.

[심사 기준]
{criteria}

[결과 분류 지침]
- Pass: 모든 요건 충족
- Fail: 명확한 부적격 사유 발견
- Pending: 데이터가 모호하여 사람의 추가 검토가 필요함

[입력 데이터]
- 창업 유형: {type}
- 본점 소재지: {location}
- 거주지: {residence}
- 생년월일: {birthDate}

[출력 형식]
반드시 아래 JSON 형식으로만 답변하세요:
{
  "status": "Pass | Fail | Pending",
  "reasoning": "판단 근거에 대한 상세 설명 (한국어)"
}`;
