const callNvidiaAPI = async (messages: { role: string; content: string | any[] }[], model: string, apiKey: string) => {
  try {
    const res = await fetch('/api/ai/nvidia', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: 1024,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `NVIDIA Proxy error: ${res.status}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (e) {
    console.error("NVIDIA API error:", e);
    throw e;
  }
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
  const prompt = `你是一位專業的藥劑師與翻譯專家。請分析以下藥物照片或文件中的資訊。
          
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
- 在回答中絕對不要使用 ** 符號。若是需要強調重點，請使用『 』括號將重點包起來（例如：『重點內容』）。
- 使用清晰的表格（Markdown 格式）與列表排版。
- 不要提及任何 AI 服務名稱。`;

  if (apiKey) {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...images.map(img => ({
            type: "image_url",
            image_url: { url: img }
          }))
        ]
      }
    ];
    return await callNvidiaAPI(messages, "meta/llama-3.2-90b-vision-instruct", apiKey);
  }

  // Fallback: Currently Ollama vision in this app might not be fully supported,
  // but we try it as text-only if no image or standard prompt
  const ollamaResponse = await callOllama(`[請分析藥物圖片並翻譯為 ${targetLanguage}]\n${prompt}`);
  if (ollamaResponse) return ollamaResponse;

  throw new Error("請前往設定輸入 NVIDIA API 金鑰以使用強大的視覺辨識模型。");
};

export const getSymptomAdvice = async (symptoms: string, mode: 'concise' | 'detailed', apiKey?: string) => {
  const instruction = mode === 'concise' 
    ? "請針對以下嬰幼兒症狀提供簡潔的用藥建議。字數控制在 200 字以內。使用繁體中文。注意：絕對不要使用 ** 符號，請使用『 』括號強調重點。"
    : "請針對以下嬰幼兒症狀提供詳細的用藥建議、病因分析與護理指南。使用繁體中文。注意：絕對不要使用 ** 符號，請使用『 』括號強調重點。";

  if (apiKey) {
    const messages = [
      { role: "system", content: instruction },
      { role: "user", content: `症狀描述：${symptoms}` }
    ];
    return await callNvidiaAPI(messages, "meta/llama-3.1-70b-instruct", apiKey);
  }

  // Fallback to Ollama
  const ollamaResponse = await callOllama(`${instruction}\n症狀描述：${symptoms}`);
  if (ollamaResponse) return ollamaResponse;

  throw new Error("無法連線至本地 Ollama，建議輸入 NVIDIA API 金鑰。");
};

export const chatWithAI = async (history: { role: string, content: string }[], message: string, apiKey?: string) => {
  const systemInstruction = "你是一位親切且專業的兒科醫療顧問集。請根據上下文回答問題。請善用表格與列表。注意：在回答中絕對不要使用 ** 符號。若要強調重點，請將其放在『 』括號內。絕對不要推銷任何 AI 產品。如果遇到緊急醫療情況，請務必提醒家長立即就醫。";

  if (apiKey) {
    const messages = [
      { role: "system", content: systemInstruction },
      ...history.map(h => ({
        role: h.role === 'user' ? 'user' : 'assistant',
        content: h.content
      })),
      { role: "user", content: message }
    ];
    return await callNvidiaAPI(messages, "meta/llama-3.1-70b-instruct", apiKey);
  }

  // Fallback to Ollama
  const prompt = history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n') + `\nUser: ${message}`;
  const ollamaResponse = await callOllama(prompt, systemInstruction);
  if (ollamaResponse) return ollamaResponse;

  throw new Error("無可用 AI 服務，請輸入 NVIDIA API 金鑰。");
};

export const generateTitleSummary = async (userMessage: string, aiResponse: string, apiKey?: string) => {
  const prompt = `請根據以下對話內容，生成一個 10-15 字的簡短標題，用於對話列表。
使用者：${userMessage}
AI：${aiResponse}

只需回傳標題文字，不要有引號或額外說明。`;

  if (apiKey) {
    try {
      const messages = [{ role: "user", content: prompt }];
      const title = await callNvidiaAPI(messages, "meta/llama-3.1-8b-instruct", apiKey);
      return title.trim();
    } catch (e) {
      console.error("NVIDIA API title error", e);
      return "新對話";
    }
  }

  // Fallback
  const ollamaResponse = await callOllama(prompt);
  if (ollamaResponse) return ollamaResponse.trim();
  
  return "新對話";
};
