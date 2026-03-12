import * as XLSX from 'xlsx';

export interface ApplicantData {
  id: string;
  name: string;
  taskNumber: string;
  birthDate: string;
  enterpriseName: string;
  historyType: string;
  locationHeadquarters: string;
  residence: string;
  age: number;
  isYouth: boolean;
  isRegional: boolean;
  ruleStatus?: 'Pass' | 'Fail';
  llmStatus?: 'Pass' | 'Fail' | 'Pending';
  llmReasoning?: string;
  finalStatus?: 'Approved' | 'Rejected' | 'Pending';
  confirmedBy?: string;
  confirmedAt?: string;
  confirmComment?: string;
  raw?: any;
}

export interface ColumnMapping {
  taskNumber?: string;
  name?: string;
  enterpriseName?: string;
  birthDate?: string;
  historyType?: string;
  locationHeadquarters?: string;
  residence?: string;
}

const REGIONAL_AREAS = ['대전', '세종', '충북', '충남'];

export const checkRegional = (location: string): boolean => {
  if (!location) return false;
  return REGIONAL_AREAS.some(area => location.includes(area));
};

/**
 * 만 나이 계산 (생년월일 + 기준일 기반)
 * 기준일 미전달 시 오늘 날짜 사용
 */
export const calculateAge = (birthDate: string, referenceDate?: Date): number => {
  if (!birthDate) return 0;

  let birthYear: number, birthMonth: number, birthDay: number;

  if (/^\d{8}$/.test(birthDate)) {
    birthYear = parseInt(birthDate.substring(0, 4));
    birthMonth = parseInt(birthDate.substring(4, 6));
    birthDay = parseInt(birthDate.substring(6, 8));
  } else if (/^\d{4}[\.\-]\d{2}[\.\-]\d{2}$/.test(birthDate)) {
    const parts = birthDate.split(/[\.\-]/);
    birthYear = parseInt(parts[0]);
    birthMonth = parseInt(parts[1]);
    birthDay = parseInt(parts[2]);
  } else {
    // 연도만 파싱 가능한 경우 fallback (월/일 정보 없음)
    const yearMatch = birthDate.match(/^\d{4}/);
    if (!yearMatch) return 0;
    return (referenceDate || new Date()).getFullYear() - parseInt(yearMatch[0]);
  }

  const ref = referenceDate || new Date();
  let age = ref.getFullYear() - birthYear;

  // 기준일 기준으로 생일이 아직 안 지났으면 1 감산
  const refMonth = ref.getMonth(); // 0-indexed
  const birthMonthIndex = birthMonth - 1; // 0-indexed
  if (
    refMonth < birthMonthIndex ||
    (refMonth === birthMonthIndex && ref.getDate() < birthDay)
  ) {
    age--;
  }

  return age;
};

/**
 * 규칙 엔진 판단: 지역 요건 충족 여부를 기반으로 Pass/Fail 결정
 * (업력 요건은 LLM이 검증하므로 크로스체크를 위해 지역 요건만 판단)
 */
export const computeRuleStatus = (isRegional: boolean): 'Pass' | 'Fail' => {
  return isRegional ? 'Pass' : 'Fail';
};

export const parseExcel = (
  buffer: Buffer,
  referenceDate?: Date,
  columnMapping?: ColumnMapping
): ApplicantData[] => {
  const cols = {
    taskNumber: columnMapping?.taskNumber || 'D',
    name: columnMapping?.name || 'F',
    enterpriseName: columnMapping?.enterpriseName || 'E',
    birthDate: columnMapping?.birthDate || 'T',
    historyType: columnMapping?.historyType || 'AN',
    locationHeadquarters: columnMapping?.locationHeadquarters || 'AZ',
    residence: columnMapping?.residence || 'AC',
  };

  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 'A' }) as any[];

  const headerStrings = ['순번', '성명', '과제번호', '사업분류', 'No.'];
  const dataRows = jsonData.filter(row => {
    const valA = String(row['A'] || '');
    return valA && !headerStrings.includes(valA) && valA !== 'undefined';
  });

  return dataRows.map((row: any, index: number) => {
    const historyType = row[cols.historyType] || '';
    const locationHeadquarters = row[cols.locationHeadquarters] || '';
    const residence = row[cols.residence] || '';
    const birthDate = String(row[cols.birthDate] || '');

    const age = calculateAge(birthDate, referenceDate);
    const isYouth = age > 0 && age <= 39;

    const isRegional = historyType.includes('예비')
      ? checkRegional(residence)
      : checkRegional(locationHeadquarters);

    return {
      id: `local-${index}`,
      name: row[cols.name] || '',
      taskNumber: String(row[cols.taskNumber] || ''),
      birthDate,
      enterpriseName: row[cols.enterpriseName] || '',
      historyType,
      locationHeadquarters,
      residence,
      age,
      isYouth,
      isRegional,
      raw: row,
    };
  });
};
