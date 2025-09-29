
import { GoogleGenAI, Type } from "@google/genai";
import { SearchParams } from '../types';

let ai: GoogleGenAI | null = null;

const getAiInstance = (): GoogleGenAI => {
  if (ai) {
    return ai;
  }

  const API_KEY = process.env.API_KEY;

  if (!API_KEY) {
    // This will be caught by the UI and shown to the user.
    throw new Error("Gemini API 키(VITE_API_KEY)가 설정되지 않았습니다. Vercel 프로젝트 설정에서 환경 변수를 추가해주세요.");
  }

  ai = new GoogleGenAI({ apiKey: API_KEY });
  return ai;
};


/**
 * Analyzes the user's natural language query to extract relevant search keywords.
 * @param query The natural language query from the user.
 * @param signal An optional AbortSignal to cancel the request.
 * @returns A promise that resolves to an array of keywords.
 */
export const analyzeQuery = async (query: string, signal?: AbortSignal): Promise<string[]> => {
    const gemini = getAiInstance();
    
    const contents = `당신은 사용자의 자연어 요청에서 Slack 검색에 사용할 핵심 키워드를 추출하는 AI 전문가입니다. 당신의 목표는 오직 검색에 필수적인 명사, 고유명사, 기술 용어만을 정확하게 식별하여, 검색 정확도를 극대화하는 것입니다.

**가장 중요한 규칙 (반드시 준수):**
당신의 임무는 요청 문장에서 **'주제'** 와 **'대상'** 에 해당하는 핵심 단어만 추출하는 것입니다. '대화', '논의', '이슈', '요청', '정리', '찾아줘' 와 같이, 검색 대상의 **내용이 아닌** 종류, 형태, 행위를 설명하는 모든 일반적인 단어는 **반드시, 예외 없이 제거해야 합니다.**

**작업 절차:**
1. 사용자의 요청 문장을 분석하여 핵심 주제가 무엇인지 파악합니다.
2. 주제와 직접 관련된 고유명사, 기술 용어, 핵심 명사만을 식별합니다.
3. 위 '가장 중요한 규칙'에 따라, 주제와 관련 없는 일반 명사, 동사, 조사, 어미 등은 모두 제거합니다.

---
**실습 예제:**

**예제 1)**
- **사용자 요청:** "샷밴드 편집 관련해서 디자인에 기능 반영해야하는 이슈"
- **올바른 사고 과정:**
    1. 이 문장의 핵심 주제는 '샷밴드', '편집', '디자인', '기능 반영'이다.
    2. '관련해서', '해야하는', '이슈'는 주제 자체가 아니라 부가적인 설명이나 행위에 해당하므로 제거해야 한다.
- **최종 키워드:** ["샷밴드", "편집", "디자인", "기능 반영"]

**예제 2)**
- **사용자 요청:** "샷밴드 디자인에 관련한 대화"
- **올바른 사고 과정:**
    1. 핵심 주제는 '샷밴드'와 '디자인'이다.
    2. '관련한', '대화'는 주제가 아닌, 주제를 꾸미는 말이거나 대화의 형태를 나타내므로 제거해야 한다.
- **최종 키워드:** ["샷밴드", "디자인"]

**예제 3)**
- **사용자 요청:** "지난주 데이터베이스 마이그레이션 계획에 대한 논의"
- **올바른 사고 과정:**
    1. 핵심 주제는 '데이터베이스 마이그레이션 계획'이다.
    2. '지난주', '에 대한', '논의'는 시간 정보이거나 부가 설명이므로 검색어에서 제외한다.
- **최종 키워드:** ["데이터베이스", "마이그레이션", "계획"]

---
**잘못된 예시 (이렇게 추출하면 안 됩니다):**

- **사용자 요청:** "샷밴드 디자인에 관련한 대화"
- **잘못된 키워드:** ["샷밴드", "디자인", "대화"]  (<- '대화'는 핵심 주제가 아니므로 절대 포함하면 안 됩니다.)

---
이제 다음 사용자 요청을 분석하여 위의 규칙과 예제에 따라 핵심 키워드만 정확하게 추출해주세요.

**사용자 요청:** "${query}"`;

    try {
        const response = await gemini.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        keywords: {
                            type: Type.ARRAY,
                            description: "추출된 검색 키워드 목록입니다. 중요도 순으로 정렬됩니다.",
                            items: {
                                type: Type.STRING,
                            }
                        }
                    },
                    required: ["keywords"]
                }
            }
        });

        const jsonResponse = JSON.parse(response.text);
        if (jsonResponse.keywords && Array.isArray(jsonResponse.keywords) && jsonResponse.keywords.length > 0) {
            return jsonResponse.keywords;
        } else {
            console.warn("AI가 키워드를 추출하지 못했습니다. 원본 쿼리를 사용합니다.");
            return [query];
        }

    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw error;
        }
        console.error("Gemini query analysis 오류:", error);
        // Rethrow the error to be displayed in the UI.
        throw error;
    }
};


const generatePrompt = (params: SearchParams, messages: any[]) => {
  const messagesJSON = JSON.stringify(messages, null, 2);

  return `
당신은 흩어진 Slack 대화를 간결하고 구조화된 Notion용 요약으로 종합하는 데 특화된 전문 AI 어시스턴트입니다.

당신의 임무는 "${params.keyword}"(와)과 관련된 주제에 대한 여러 채널에서 수집된 Slack 메시지가 포함된 아래 JSON 데이터를 분석하는 것입니다. 각 JSON 객체는 하나의 대화 스레드를 나타냅니다. 객체에는 원본 메시지가 포함되어 있으며, 'replies' 배열에는 해당 메시지에 달린 모든 답글이 시간순으로 포함되어 있습니다.

**핵심 지침:**
1.  **스레드 중심 분석:** 각 대화 객체를 하나의 완결된 논의 단위로 분석합니다. 원본 메시지와 그에 달린 'replies'를 함께 고려하여 전체 대화의 맥락을 파악합니다.
2.  **시간순 재구성 및 필터링:** 모든 스레드를 타임스탬프 순으로 정렬하여 전체 토론의 진행 과정을 파악합니다. 간단한 인사, 관련 없는 잡담 등은 제외하고 "${params.keyword}"에 대한 핵심 논의에만 집중합니다.
3.  **핵심 요소 추출:** 재구성된 대화 흐름을 바탕으로 다음 핵심 요소들을 식별하고 요약합니다. 제공된 메시지에만 근거하여 철저하게 요약해야 합니다. 만약 특정 섹션에 관련 정보가 없다면, 명확하게 명시해주세요 (예: "제공된 메시지에서는 최종 결정이 기록되지 않았습니다.").
4.  **참여자 식별:** 대화에 실질적으로 기여한 핵심 인물들을 식별합니다.
5.  **출력 형식 지정:** 최종 결과물은 Notion과 호환되는 마크다운 형식으로 생성합니다. 각 요약 항목에는 논의가 시작된 원본 메시지의 Slack 퍼머링크를 하이퍼링크로 반드시 포함해야 합니다.

**Slack 대화(스레드) JSON 데이터:**
${messagesJSON}

**원하는 마크다운 출력 구조:**

# Slack 대화 요약: ${params.keyword}

- **기간:** ${params.startDate} ~ ${params.endDate}
- **주요 참여자:** @User1, @User2, @User3

## 1. 문제 정의
- [논의된 문제에 대한 요약, 논의가 시작된 원본 메시지 링크 포함](https://...)

## 2. 대안 및 주요 논의
- **대안 A:** [논의된 첫 번째 옵션에 대한 설명](https://...)
  - **장점:** [언급된 장점 목록](https://...)
  - **단점:** [언급된 단점 목록](https://...)
- **대안 B:** [논의된 두 번째 옵션에 대한 설명](https://...)
  - **장점:** [언급된 장점 목록](https://...)
  - **단점:** [언급된 단점 목록](https://...)

## 3. 최종 결정
- [도달한 최종 결정 사항을 명확하게 기술](https://...)

## 4. 결정 근거
- [최종 결정을 내리는 데 인용된 이유와 근거](https://...)
`;
};


export const summarizeDiscussions = async (params: SearchParams, messages: any[], signal?: AbortSignal): Promise<string> => {
  const gemini = getAiInstance();
  const prompt = generatePrompt(params, messages);

  try {
    // The 'signal' property is not supported in 'GenerateContentParameters' for the SDK.
    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // Re-throw the AbortError as is so the UI can specifically handle it.
      // This part might not be triggered if the SDK doesn't support AbortSignal.
      throw error;
    }
    console.error("Gemini API 호출 오류:", error);
    throw new Error(`오류: 요약을 생성할 수 없습니다. 자세한 내용은 콘솔을 확인해주세요.`);
  }
};