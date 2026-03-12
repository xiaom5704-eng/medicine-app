import { GoogleGenAI, Type } from "@google/genai";

const getGeminiClient = (apiKey?: string) => {
  return new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || "" });
};

const callOllama = async (prompt: string, system?: string) => {
  try {
    const res = await fetch('/api/ai/ollama', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, system }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.response;
  } catch (e) {
    return null;
  }
};

export const analyzeMedications = async (images: string[], targetLanguage: string = "繁體中文", apiKey?: string) => {
  // Ollama usually doesn't support vision as well as Gemini in 3b models, 
  // so we might want to stick to Gemini for vision or use a vision-capable Ollama model.
  // For this requirement, we'll try Ollama if it's just text, but images need Gemini.
  const ai = getGeminiClient(apiKey);
  const model = ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [
      {
        parts: [
          { text: `你是一位專業的藥劑師與翻譯專家。請分析以下藥物照片或文件中的資訊。
          
要求：
1. 辨識圖片中的所有文字，包含各國語言（如日文、英文、德文等）。
2. 將所有藥物名稱、成分描述與使用說明翻譯成「${targetLanguage}」。
3. 請列出每種藥物的：
   - 原始名稱與翻譯名稱
   - 治療功能 (翻譯後)
   - 詳細成分清單 (翻譯後)
   - 風險與副作用 (翻譯後)
4. 判斷這些藥物之間是否存在交互作用（相衝）風險。

注意：
- 回答中絕對不要使用 ** 符號進行加粗。
- 使用清晰的換行與列表排版。
- 不要提及任何 AI 服務名稱。` },
          ...images.map(img => ({
            inlineData: {
              mimeType: "image/jpeg",
              data: img.split(',')[1]
            }
          }))
        ]
      }
    ]
  });

  const response = await model;
  return response.text;
};

export const getSymptomAdvice = async (symptoms: string, mode: 'concise' | 'detailed', apiKey?: string) => {
  const instruction = mode === 'concise' 
    ? "請針對以下嬰兒症狀提供簡潔的用藥建議與注意事項。字數控制在 200 字以內。使用繁體中文。注意：回答中絕對不要使用 ** 符號進行加粗。"
    : "請針對以下嬰兒症狀提供詳細的用藥建議、可能的病因分析、居家護理指南以及何時必須就醫的警訊。使用繁體中文。注意：回答中絕對不要使用 ** 符號進行加粗。";

  // Try Ollama first
  const ollamaResponse = await callOllama(`${instruction}\n症狀描述：${symptoms}`);
  if (ollamaResponse) return ollamaResponse;

  const ai = getGeminiClient(apiKey);
  const model = ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [{ parts: [{ text: `${instruction}\n症狀描述：${symptoms}` }] }]
  });

  const response = await model;
  return response.text;
};

export const chatWithAI = async (history: { role: string, content: string }[], message: string, apiKey?: string) => {
  const systemInstruction = "你是一位親切且專業的兒科醫療顧問。請根據上下文回答問題。請注意：在回答時絕對不要使用 Markdown 的加粗符號（例如 **文字**），請使用純文字或換行來區隔重點。絕對不要推銷任何 AI 產品。如果遇到緊急醫療情況，請務必提醒家長立即就醫。";

  // Try Ollama first
  const prompt = history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n') + `\nUser: ${message}`;
  const ollamaResponse = await callOllama(prompt, systemInstruction);
  if (ollamaResponse) return ollamaResponse;

  const ai = getGeminiClient(apiKey);
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [
      ...history.map(h => ({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.content }]
      })),
      { role: 'user', parts: [{ text: message }] }
    ],
    config: {
      systemInstruction
    }
  });

  return response.text;
};

export const generateTitleSummary = async (userMessage: string, aiResponse: string, apiKey?: string) => {
  const prompt = `請根據以下對話內容，生成一個 10-15 字的簡短標題，用於對話列表。
使用者：${userMessage}
AI：${aiResponse}

只需回傳標題文字，不要有引號或額外說明。`;

  const ollamaResponse = await callOllama(prompt);
  if (ollamaResponse) return ollamaResponse.trim();

  try {
    const ai = getGeminiClient(apiKey);
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [{
        parts: [{ text: prompt }]
      }]
    });
    return response.text?.trim() || "新對話";
  } catch (error) {
    console.error("Error generating title summary:", error);
    return "新對話";
  }
};
