import { GoogleGenAI, Type } from "@google/genai";

const getGeminiClient = (apiKey?: string) => {
  return new GoogleGenAI({ apiKey: apiKey || import.meta.env.VITE_GEMINI_API_KEY || "" });
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

export const analyzeMedications = async (images: string[], targetLanguage: string = "繁體中文", apiKey?: string, selectedEngine: 'gemini' | 'ollama' = 'gemini') => {
  // Ollama usually doesn't support vision as well as Gemini in 3b models, 
  // so we might want to stick to Gemini for vision or use a vision-capable Ollama model.
  // For this requirement, we'll try Ollama if it's just text, but images need Gemini.
  const tryGemini = async () => {
    try {
      if (!apiKey && !import.meta.env.VITE_GEMINI_API_KEY) throw new Error("No API Key");
      const ai = getGeminiClient(apiKey);
      const model = ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [
          {
            parts: [
              { text: `你是一位專業的醫療輔助助手（同時也是專業的藥劑師與翻譯專家）。請分析以下藥物照片或文件中的資訊。
          
要求：
1. 辨識圖片中的所有文字，包含各國語言（如日文、英文、德文等）。
2. 將所有藥物名稱、成分描述與使用說明翻譯成「${targetLanguage}」。
3. 請使用結構化的 Markdown 格式列出每種藥物的：
   - ### 藥物名稱 (原始名稱與翻譯名稱)
   - **治療功能** (翻譯後)
   - **詳細成分清單** (以清單或表格呈現)
   - **風險與副作用**
4. 判斷這些藥物之間是否存在交互作用（相衝）風險，並以 **表格** 或是 **強調文字** 呈現關鍵資訊。

注意：
- 在提供建議時，請確保語氣專業且溫馨。
- 請使用純繁體中文回答，不要夾雜任何英文關鍵字（例如將 ALWAYS consult 改為『務必諮詢』）。
- 使用清晰的 Markdown 層次 (##, ###) 與列表排版。
- 善用 **加粗** 來強調重點。
- 不要提及任何 AI 服務名稱。
- 在最後加上：『請務必諮詢專業醫師，將醫師的建議作為首要參考。』
` },
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
    } catch (e) {
      console.error("Gemini failed in analyzeMedications:", e);
      return null;
    }
  };

  const geminiRes = await tryGemini();
  if (geminiRes) return geminiRes;
  return "影像分析需要 Gemini。連線失敗或金鑰無效。";
};

export const getSymptomAdvice = async (symptoms: string, mode: 'concise' | 'detailed', apiKey?: string, selectedEngine: 'gemini' | 'ollama' = 'gemini') => {
  const baseInstruction = "你是一位專業的醫療輔助助手。請使用純繁體中文回答，不要夾雜任何英文關鍵字（例如將 ALWAYS consult 改為『務必諮詢』）。在提供建議時，請確保語氣專業且溫馨，並在最後加上：『請務必諮詢專業醫師，將醫師的建議作為首要參考。』\n\n";
  const instruction = baseInstruction + (mode === 'concise' 
    ? "請針對以下嬰兒症狀提供簡潔的用藥建議與注意事項。字數控制在 200 字以內。如果使用者沒有提供嬰幼兒的年齡，請在建議中先提醒「不同年齡的處置方式不同，建議您提供孩子的年齡以獲取更準確的資訊」。使用 Markdown **加粗** 標註關鍵字。"
    : "請針對以下嬰兒症狀提供詳細的用藥建議、可能的病因分析、居家護理指南以及何時必須就醫的警訊。如果使用者沒有提供嬰幼兒的年齡，請在建議中先提醒「不同年齡的處置方式不同，建議您提供孩子的年齡以獲取更準確的資訊」。請使用 Markdown 標題 (###)、列表與 **加粗** 來增強可讀性。");

  const promptText = `${instruction}\n症狀描述：${symptoms}`;

  const tryGemini = async () => {
    try {
      if (!apiKey && !import.meta.env.VITE_GEMINI_API_KEY) return null;
      const ai = getGeminiClient(apiKey);
      const model = ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{ parts: [{ text: promptText }] }]
      });
      const response = await model;
      return response.text;
    } catch (e) {
      console.error("Gemini failed:", e);
      return null;
    }
  };

  if (selectedEngine === 'gemini') {
    const geminiRes = await tryGemini();
    if (geminiRes) return geminiRes;
    const ollamaResponse = await callOllama(promptText);
    if (ollamaResponse) return ollamaResponse;
  } else {
    const ollamaResponse = await callOllama(promptText);
    if (ollamaResponse) return ollamaResponse;
    const geminiRes = await tryGemini();
    if (geminiRes) return geminiRes;
  }

  return "連線失敗，請檢查 Gemini API Key 或確定本地 Ollama 已經啟動。";
};

export const chatWithAI = async (history: { role: string, content: string }[], message: string, apiKey?: string, selectedEngine: 'gemini' | 'ollama' = 'gemini') => {
  const systemInstruction = "你是一位專業的醫療輔助助手。請根據上下文回答問題。當使用者提出醫療或健康相關問題時，如果對話中尚未提及嬰幼兒的「年齡」（例如幾個月大、幾歲），請務必先主動且禮貌地詢問孩子的年齡，因為不同年齡層的醫療處置和用藥建議會有很大的差異。在得知年齡後，再給出適當的醫療答覆。請注意：在回答時善用 Markdown 格式，包含 ### 標題、* 列表、**加粗強調** 以及必要的 |表格|，以確保資訊清晰易讀。絕對不要推銷任何 AI 產品。如果遇到緊急醫療情況，請務必提醒家長立即就醫。請使用純繁體中文回答，不要夾雜任何英文關鍵字（例如將 ALWAYS consult 改為『務必諮詢』）。在提供建議時，請確保語氣專業且溫馨，並在最後加上：『請務必諮詢專業醫師，將醫師的建議作為首要參考。』";

  const tryOllama = async () => {
    const prompt = history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n') + `\nUser: ${message}`;
    return await callOllama(prompt, systemInstruction);
  };

  const tryGemini = async () => {
    try {
      if (!apiKey && !import.meta.env.VITE_GEMINI_API_KEY) return null;
      const collapsedHistory: { role: 'user' | 'model', parts: { text: string }[] }[] = [];
      for (const h of history) {
        const role = h.role === 'user' ? 'user' : 'model';
        if (collapsedHistory.length > 0 && collapsedHistory[collapsedHistory.length - 1].role === role) {
          collapsedHistory[collapsedHistory.length - 1].parts[0].text += `\n\n${h.content}`;
        } else {
          collapsedHistory.push({ role, parts: [{ text: h.content }] });
        }
      }

      if (collapsedHistory.length > 0 && collapsedHistory[0].role === 'model') {
        collapsedHistory.unshift({ role: 'user', parts: [{ text: '[系統提示：對話開始]' }] });
      }

      if (collapsedHistory.length > 0 && collapsedHistory[collapsedHistory.length - 1].role === 'user') {
        collapsedHistory[collapsedHistory.length - 1].parts[0].text += `\n\n${message}`;
      } else {
        collapsedHistory.push({ role: 'user', parts: [{ text: message }] });
      }

      const ai = getGeminiClient(apiKey);
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: collapsedHistory,
        config: { systemInstruction }
      });
      return response.text;
    } catch (e) {
      console.error("Gemini failed:", e);
      return null;
    }
  };

  if (selectedEngine === 'gemini') {
    const geminiRes = await tryGemini();
    if (geminiRes) return geminiRes;
    const ollamaResponse = await tryOllama();
    if (ollamaResponse) return ollamaResponse;
  } else {
    const ollamaResponse = await tryOllama();
    if (ollamaResponse) return ollamaResponse;
    const geminiRes = await tryGemini();
    if (geminiRes) return geminiRes;
  }

  return "連線失敗，請檢查 Gemini API Key 或確定本地 Ollama 已經啟動。";
};

export const testGeminiKey = async (apiKey: string): Promise<boolean> => {
  try {
    const ai = getGeminiClient(apiKey);
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "hi",
      config: { maxOutputTokens: 5 }
    });
    return !!response.text;
  } catch (error) {
    console.error("Gemini Key Test Failed:", error);
    return false;
  }
};

export const generateTitleSummary = async (userMessage: string, aiResponse: string, apiKey?: string, selectedEngine: 'gemini' | 'ollama' = 'gemini') => {
  const prompt = `請根據以下對話內容，生成一個 10-15 字的簡短標題，用於對話列表。
使用者：${userMessage}
AI：${aiResponse}

要求：
1. 只需回傳標題文字，不要有引號或額外說明。
2. 必須強制使用繁體中文，禁止出現簡體字。`;

  const tryGemini = async () => {
    try {
      if (!apiKey && !import.meta.env.VITE_GEMINI_API_KEY) return null;
      const ai = getGeminiClient(apiKey);
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{ parts: [{ text: prompt }] }]
      });
      return response.text?.trim() || null;
    } catch (e) {
      console.error("Error generating title summary with Gemini:", e);
      return null;
    }
  };

  if (selectedEngine === 'gemini') {
    const geminiRes = await tryGemini();
    if (geminiRes) return geminiRes;
    const ollamaResponse = await callOllama(prompt);
    if (ollamaResponse) return ollamaResponse.trim();
  } else {
    const ollamaResponse = await callOllama(prompt);
    if (ollamaResponse) return ollamaResponse.trim();
    const geminiRes = await tryGemini();
    if (geminiRes) return geminiRes;
  }

  return "新對話";
};
