import { GoogleGenAI, Type } from "@google/genai";
import { SearchParams } from '../types';

// IMPORTANT: This key is managed by the execution environment.
// Do not hardcode or manage it in the UI.
// FIX: Switched to process.env.API_KEY as per @google/genai guidelines. This also resolves the `import.meta.env` type error.
if (!process.env.API_KEY) {
  // In a real app, you might want to handle this more gracefully,
  // but for this context, we assume the key is present.
  console.warn("API_KEY environment variable is not set. Gemini API calls will fail.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

/**
 * Analyzes the user's natural language query to extract relevant search keywords.
 * @param query The natural language query from the user.
 * @param signal An optional AbortSignal to cancel the request.
 * @returns A promise that resolves to an array of keywords.
 */
export const analyzeQuery = async (query: string, signal?: AbortSignal): Promise<string[]> => {
    if (!process.env.API_KEY) {
        throw new Error("Gemini API key is not configured in environment variables.");
    }
    
    const contents = `You are an AI expert specializing in extracting core keywords for Slack search from a user's natural language request. Your goal is to accurately identify only the essential nouns, proper nouns, and technical terms to maximize search accuracy.

**Most Important Rule (Must be followed):**
Your mission is to extract only the core words corresponding to the **'subject'** and **'object'** from the request sentence. You **must, without exception, remove** all common words that describe the type, form, or action of the search target, rather than its **content**, such as 'conversation', 'discussion', 'issue', 'request', 'summary', 'find'.

**Procedure:**
1. Analyze the user's request sentence to understand the core topic.
2. Identify only the proper nouns, technical terms, and core nouns directly related to the topic.
3. Following the 'Most Important Rule' above, remove all unrelated common nouns, verbs, particles, etc.

---
**Examples:**

**Example 1)**
- **User Request:** "Issue about reflecting features in the design related to shot band editing"
- **Correct Thought Process:**
    1. The core topics of this sentence are 'shot band', 'editing', 'design', 'feature reflection'.
    2. 'Issue about', 'related to' are supplementary descriptions or actions, not the topics themselves, so they must be removed.
- **Final Keywords:** ["shot band", "editing", "design", "feature reflection"]

**Example 2)**
- **User Request:** "Conversation about shot band design"
- **Correct Thought Process:**
    1. The core topics are 'shot band' and 'design'.
    2. 'Conversation about' describes the form of the discussion, not the topic, so it must be removed.
- **Final Keywords:** ["shot band", "design"]

**Example 3)**
- **User Request:** "Discussion about last week's database migration plan"
- **Correct Thought Process:**
    1. The core topic is 'database migration plan'.
    2. 'Discussion about', 'last week's' are supplementary descriptions or time information and should be excluded from the search terms.
- **Final Keywords:** ["database", "migration", "plan"]

---
**Incorrect Example (Do not extract like this):**

- **User Request:** "Conversation about shot band design"
- **Incorrect Keywords:** ["shot band", "design", "conversation"]  (<- 'conversation' is not a core topic and must never be included.)

---
Now, analyze the following user request and extract only the core keywords accurately according to the rules and examples above.

**User Request:** "${query}"`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        keywords: {
                            type: Type.ARRAY,
                            description: "A list of extracted search keywords, sorted by importance.",
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
            console.warn("AI could not extract keywords. Using original query.");
            return [query];
        }

    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw error;
        }
        console.error("Gemini query analysis error:", error);
        console.log("AI analysis failed. Using original query as keyword.");
        return [query];
    }
};


const generatePrompt = (params: SearchParams, messages: any[]) => {
  const messagesJSON = JSON.stringify(messages, null, 2);

  return `
You are a specialized AI assistant expert in synthesizing scattered Slack conversations into a concise, structured summary for Notion.

Your task is to analyze the JSON data below, which contains Slack messages collected from various channels on the topic related to "${params.keyword}". Each JSON object represents a single conversation thread. The object includes the original message, and the 'replies' array contains all replies to that message in chronological order.

**Core Instructions:**
1.  **Thread-Centric Analysis:** Analyze each conversation object as a complete unit of discussion. Consider the original message and its 'replies' together to grasp the full context of the conversation.
2.  **Chronological Reconstruction and Filtering:** Sort all threads by timestamp to understand the progression of the entire discussion. Exclude simple greetings, irrelevant chatter, etc., and focus solely on the core discussion about "${params.keyword}".
3.  **Extract Key Elements:** Based on the reconstructed conversation flow, identify and summarize the following key elements. The summary must be based strictly on the provided messages. If information for a particular section is not available, state it clearly (e.g., "A final decision was not recorded in the provided messages.").
4.  **Identify Participants:** Identify the key individuals who substantially contributed to the conversation.
5.  **Specify Output Format:** Generate the final output in Notion-compatible Markdown format. Each summary point must include the Slack permalink of the original message where the discussion started as a hyperlink.

**Slack Conversation (Thread) JSON Data:**
${messagesJSON}

**Desired Markdown Output Structure:**

# Slack Conversation Summary: ${params.keyword}

- **Period:** ${params.startDate} to ${params.endDate}
- **Key Participants:** @User1, @User2, @User3

## 1. Problem Definition
- [Summary of the discussed problem, including the link to the original message where the discussion started](https://...)

## 2. Alternatives & Key Discussions
- **Alternative A:** [Description of the first option discussed](https://...)
  - **Pros:** [List of mentioned advantages](https://...)
  - **Cons:** [List of mentioned disadvantages](https://...)
- **Alternative B:** [Description of the second option discussed](https://...)
  - **Pros:** [List of mentioned advantages](https://...)
  - **Cons:** [List of mentioned disadvantages](https://...)

## 3. Final Decision
- [Clearly state the final decision reached](https://...)

## 4. Rationale for Decision
- [The reasons and evidence cited for making the final decision](https://...)
`;
};


export const summarizeDiscussions = async (params: SearchParams, messages: any[], signal?: AbortSignal): Promise<string> => {
  if (!process.env.API_KEY) {
    throw new Error("Gemini API key is not configured in environment variables.");
  }

  const prompt = generatePrompt(params, messages);

  try {
    // The 'signal' property is not supported in 'GenerateContentParameters' for the SDK.
    const response = await ai.models.generateContent({
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
    console.error("Gemini API call error:", error);
    throw new Error("Could not generate summary. See console for details.");
  }
};