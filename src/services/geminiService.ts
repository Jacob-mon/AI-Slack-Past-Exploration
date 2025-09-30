import { GoogleGenAI, Type } from "@google/genai";
import { SearchParams } from '../types';

const API_KEY = process.env.API_KEY;
let ai: GoogleGenAI | null = null;

// Initialize the AI client only if the API key is available.
// This prevents a crash on startup if the key is missing or invalid.
if (API_KEY && API_KEY !== 'undefined') {
  try {
    ai = new GoogleGenAI({ apiKey: API_KEY });
  } catch (error) {
    console.error("Failed to initialize GoogleGenAI, likely due to an invalid API key:", error);
  }
} else {
  console.warn("Gemini API key (VITE_API_KEY) is not configured in environment variables. API calls will fail.");
}

/**
 * Analyzes the user's natural language query to extract relevant search keywords.
 * @param query The natural language query from the user.
 * @param signal An optional AbortSignal to cancel the request.
 * @returns A promise that resolves to an array of keywords.
 */
export const analyzeQuery = async (query: string, signal?: AbortSignal): Promise<string[]> => {
    if (!ai) {
        throw new Error("Gemini AI service is not initialized. Please check your VITE_API_KEY environment variable.");
    }
    
    const contents = `You are an AI expert at extracting key search terms from a user's natural language request for a Slack search. Your goal is to accurately identify only the essential nouns, proper nouns, and technical terms to maximize search accuracy.

**The Most Important Rule (Must be followed):**
Your mission is to extract only the core words corresponding to the **'subject'** and **'object'** from the request sentence. You **must, without exception, remove** all common words that describe the type, form, or action of the search target, but not the **content** itself, such as 'conversation', 'discussion', 'issue', 'request', 'summary', 'find'.

**Procedure:**
1. Analyze the user's request to understand the main topic.
2. Identify only the proper nouns, technical terms, and core nouns directly related to the topic.
3. Following 'The Most Important Rule' above, remove all unrelated common nouns, verbs, particles, etc.

---
**Examples:**

**Example 1)**
- **User Request:** "Issue about reflecting design features related to shot band editing"
- **Correct Thought Process:**
    1. The core topics of this sentence are 'shot band', 'editing', 'design', 'feature reflection'.
    2. 'about', 'related to', 'issue' are supplementary descriptions or actions, not the topic itself, so they must be removed.
- **Final Keywords:** ["shot band", "editing", "design", "feature reflection"]

**Example 2)**
- **User Request:** "Conversation about the shot band design"
- **Correct Thought Process:**
    1. The core topics are 'shot band' and 'design'.
    2. 'about', 'conversation' are modifiers or describe the form of the dialogue, so they should be removed.
- **Final Keywords:** ["shot band", "design"]

**Example 3)**
- **User Request:** "Discussion about last week's database migration plan"
- **Correct Thought Process:**
    1. The core topic is 'database migration plan'.
    2. 'last week's', 'about', 'discussion' are time information or supplementary descriptions and should be excluded from the search query.
- **Final Keywords:** ["database", "migration", "plan"]

---
**Incorrect Example (Do not extract like this):**

- **User Request:** "Conversation about the shot band design"
- **Incorrect Keywords:** ["shot band", "design", "conversation"]  (<- 'conversation' is not a core topic and must not be included.)

---
Now, analyze the following user request and extract only the core keywords according to the rules and examples above.

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
                            description: "List of extracted search keywords, sorted by importance.",
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
            console.warn("AI failed to extract keywords. Using original query.");
            return [query];
        }

    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw error;
        }
        console.error("Gemini query analysis error:", error);
        console.log("AI analysis failed. Using original query as search term.");
        return [query];
    }
};


const generatePrompt = (params: SearchParams, messages: any[]) => {
  const messagesJSON = JSON.stringify(messages, null, 2);

  return `
You are a specialized AI assistant expert at synthesizing scattered Slack conversations into a concise, structured summary for Notion.

Your mission is to analyze the JSON data below, which contains Slack messages collected from various channels on the topic of "${params.keyword}". Each JSON object represents a single conversation thread. The object contains the original message, and the 'replies' array includes all replies to that message in chronological order.

**Core Instructions:**
1.  **Thread-Centric Analysis:** Analyze each conversation object as a complete unit of discussion. Consider the original message and its 'replies' together to understand the full context.
2.  **Chronological Reconstruction & Filtering:** Sort all threads by timestamp to understand the progression of the entire discussion. Exclude simple greetings and irrelevant chatter, focusing only on the core discussion about "${params.keyword}".
3.  **Extract Key Elements:** Based on the reconstructed conversation flow, identify and summarize the following key elements. The summary must be based strictly on the provided messages. If information for a particular section is not present, state so clearly (e.g., "The final decision was not recorded in the provided messages.").
4.  **Identify Participants:** Identify the key individuals who substantially contributed to the conversation.
5.  **Specify Output Format:** Generate the final output in Notion-compatible Markdown format. Each summary point must include a hyperlink to the original message's Slack permalink where the discussion started.

**Slack Conversation (Thread) JSON Data:**
${messagesJSON}

**Desired Markdown Output Structure:**

# Slack Conversation Summary: ${params.keyword}

- **Period:** ${params.startDate} ~ ${params.endDate}
- **Key Participants:** @User1, @User2, @User3

## 1. Problem Definition
- [Summary of the discussed problem, including a link to the original message where the discussion began](https://...)

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
  if (!ai) {
    throw new Error("Gemini AI service is not initialized. Please check your VITE_API_KEY environment variable.");
  }

  const prompt = generatePrompt(params, messages);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    console.error("Gemini API call error:", error);
    throw new Error(`Error: Could not generate summary. Check the console for details.`);
  }
};