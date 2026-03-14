import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import fs from "fs/promises";
import "dotenv/config";

// ─── Configuration ────────────────────────────────────────────────────────────
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const OLLAMA_URL = process.env.OLLAMA_API_BASE_URL || "http://localhost:11434";
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Mode Specific System Prompts ───────────────────────────────────────────
const CHAT_SYSTEM_PROMPT = "【強制規範：全程使用繁體中文，嚴禁任何簡體字】你是一位親切且專業的全齡醫療與生活助手。請提供正確且有溫度的建議。注意：在回答中絕對不要使用 ** 符號。若要強調重點，請將其放在『 』括號內。絕對不要推銷任何 AI 產品。若使用者詢問與醫療無關的問題，請以專業助手的角度回答。再次強調：回覆必須文字完全為繁體中文。";

const SYMPTOM_SYSTEM_PROMPT = `【強制規範：全程使用繁體中文，嚴禁任何簡體字，必須使用 --- 標籤】
你是一位專業的家庭醫師。請針對使用者的症狀提供建議。
  
要求：
1. 回覆結構：你「必須」使用 --- 符號將回覆分為兩個部分。
   第一部分是 [ 快速摘要 ]：提供 100 字以內的精簡結論與緊急處置。
   第二部分是 [ 深度分析 ]：提供詳細的病因分析、護理指南與長期觀察建議。
   注意：如果沒有 --- 符號，介面將無法正確顯示與標籤切換。
2. 身分與年齡邏輯：
   - 階段一（未知年齡）：如果在對話歷史中找不到使用者的年齡或出生年月日，你必須在回覆開頭禮貌地詢問「請問患者的年齡或出生年月日？」。
   - 階段二（已知年齡）：一旦使用者提供資訊（如「2006年9月27日」），你必須立即計算當前年齡（目前為 19 歲），並將後續所有建議鎖定在此年齡層。
3. 精準醫療：嚴禁提供不符合該年齡層的醫學資訊。例如使用者是 19 歲成年人，不准出現乳汁過多、嬰幼兒照護或不相關的兒童藥物建議。
4. 格式：使用「條列式」與表格排版。
5. 語言規範：回覆文字「必須完全為繁體中文」，嚴禁出現任何簡體字（如：体、国、学、会等）。絕對不要使用 ** 符號，請使用『 』強調。
6. 警示：若情況緊急，必須提醒立即就醫。

再次強調：回覆必須包含 --- 分隔符號，且文字必須完全身為繁體中文。`;

const db = new Database("medsafe.db");

// ─── WAL mode for better concurrency ─────────────────────────────────────────
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    is_pinned INTEGER DEFAULT 0,
    is_manual_title INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    role TEXT CHECK(role IN ('user', 'assistant')),
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
`);

// ─── Migrations for existing databases ───────────────────────────────────────
try { db.exec("ALTER TABLE sessions ADD COLUMN is_pinned INTEGER DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE sessions ADD COLUMN is_manual_title INTEGER DEFAULT 0"); } catch (_) {}

// ─── Input validation helpers ─────────────────────────────────────────────────
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID_RE.test(id);
}

function isValidRole(role: unknown): role is 'user' | 'assistant' {
  return role === 'user' || role === 'assistant';
}

function isValidString(s: unknown, maxLen: number): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= maxLen;
}

// ─── Simple in-memory rate limiter ────────────────────────────────────────────
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string, maxReq = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(ip);
  if (!record || now > record.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + windowMs });
    return true; // allowed
  }
  record.count++;
  if (record.count > maxReq) return false; // blocked
  return true;
}

function rateLimitMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip ?? 'unknown';
  if (!rateLimit(ip)) {
    return res.status(429).json({ error: "Too many requests, please try again later." });
  }
  next();
}

async function startServer() {
  const app = express();
  // PORT is now defined in Configuration section at top

  // ─── Security headers ─────────────────────────────────────────────────────
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  // ─── Body parser with safe limit ─────────────────────────────────────────
  // 10 MB covers base64-encoded images (≈7 MB raw) while blocking DoS payloads
  app.use(express.json({ limit: '10mb' }));

  // ─── Apply rate limiting to all /api routes ───────────────────────────────
  app.use('/api', rateLimitMiddleware);

  // ─── Sessions ─────────────────────────────────────────────────────────────
  app.get("/api/sessions", (_req, res) => {
    try {
      const dbSessions = db.prepare(
        "SELECT * FROM sessions ORDER BY is_pinned DESC, created_at DESC"
      ).all() as any[];
      
      const safeSessions = dbSessions.map(session => ({
        ...session,
        title: session.title || '未命名對話' // Fallback for null titles
      }));
      res.json(safeSessions);
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
      res.status(500).json({ error: "Failed to fetch sessions" });
    }
  });

  app.post("/api/sessions", (req, res) => {
    const { id, title } = req.body;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid session ID" });
    if (!isValidString(title, 200)) return res.status(400).json({ error: "Invalid title" });

    db.prepare(
      "INSERT OR IGNORE INTO sessions (id, title, is_pinned, is_manual_title) VALUES (?, ?, 0, 0)"
    ).run(id, title);
    res.json({ success: true });
  });

  app.patch("/api/sessions/:id", (req, res) => {
    const sessionId = req.params.id;
    if (!isValidId(sessionId)) return res.status(400).json({ error: "Invalid session ID" });

    const { title, is_pinned, is_manual_title } = req.body;

    if (title !== undefined) {
      if (!isValidString(title, 200)) return res.status(400).json({ error: "Invalid title" });
      db.prepare(
        "UPDATE sessions SET title = ?, is_manual_title = ? WHERE id = ?"
      ).run(title, is_manual_title ? 1 : 0, sessionId);
    }
    if (is_pinned !== undefined) {
      db.prepare(
        "UPDATE sessions SET is_pinned = ? WHERE id = ?"
      ).run(is_pinned ? 1 : 0, sessionId);
    }
    res.json({ success: true });
  });

  app.delete("/api/sessions/:id", (req, res) => {
    const sessionId = req.params.id;
    if (!isValidId(sessionId)) return res.status(400).json({ error: "Invalid session ID" });

    try {
      db.transaction(() => {
        db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
        db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
      })();
      res.json({ success: true });
    } catch (error) {
      console.error("Delete session failed:", error);
      res.status(500).json({ error: "Failed to delete session" });
    }
  });

  // ─── Messages ─────────────────────────────────────────────────────────────
  app.get("/api/messages/:sessionId", (req, res) => {
    const sessionId = req.params.sessionId;
    if (!isValidId(sessionId)) return res.status(400).json({ error: "Invalid session ID" });

    try {
      const dbMessages = db.prepare(
        "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC"
      ).all(sessionId) as any[];

      const safeMessages = dbMessages.map(msg => ({
        ...msg,
        content: msg.content || ' ' // Fallback for null database content
      }));
      res.json(safeMessages);
    } catch (error) {
      console.error("Failed to fetch messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.post("/api/messages", (req, res) => {
    const { session_id, role, content } = req.body;

    if (!isValidId(session_id)) return res.status(400).json({ error: "Invalid session ID" });
    if (!isValidRole(role)) return res.status(400).json({ error: "Invalid role" });
    // Allow up to 32KB of message content (handles long AI responses)
    if (!isValidString(content, 32_768)) return res.status(400).json({ error: "Content too long or empty" });

    db.prepare(
      "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)"
    ).run(session_id, role, content);

    // Auto-generate title on assistant's first reply (the 2nd message in session)
    if (role === 'assistant') {
      try {
        const row = db.prepare(
          "SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?"
        ).get(session_id) as { cnt: number } | undefined;

        if (row?.cnt === 2) {
          const session = db.prepare(
            "SELECT is_manual_title FROM sessions WHERE id = ?"
          ).get(session_id) as { is_manual_title: number } | undefined;

          if (session && !session.is_manual_title) {
            const apiKey = process.env.NVIDIA_API_KEY || '';
            generateChatTitle(session_id, apiKey).catch(err => 
              console.error(`[TitleGen] Background task failed for ${session_id}:`, err)
            );
          }
        }
      } catch (err) {
        console.error("[TitleGen] Pre-check failed:", err);
      }
    }

    res.json({ success: true });
  });

  // ─── Chat title generation (internal helper) ──────────────────────────────
  async function generateChatTitle(sessionId: string, apiKey: string) {
    try {
      const msgs = db.prepare(
        "SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 2"
      ).all(sessionId) as any[];
      if (msgs.length < 2) return;

      const userMsg = (msgs[0].content as string).substring(0, 500);
      const aiMsg  = (msgs[1].content as string).substring(0, 500);
      const prompt = `請根據這段對話內容，總結出一個 6 個字以內的繁體中文標題。\n使用者：${userMsg}\nAI：${aiMsg}\n只需回傳標題文字，不要有引號或額外說明。`;

      let title = "";

      if (apiKey) {
        const response = await fetch(NVIDIA_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: "meta/llama-3.1-8b-instruct",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            max_tokens: 50
          }),
        });
        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          if (typeof content === 'string') {
            title = content.trim().replace(/[「」『』""]/g, '');
          }
        }
      }

      if (!title) {
        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: "llama3.2:3b", prompt, stream: false }),
        });
        if (response.ok) {
          const data = await response.json();
          const content = data.response;
          if (typeof content === 'string') {
            title = content.trim().replace(/[「」『』""]/g, '');
          }
        }
      }

      if (title) {
        title = title.substring(0, 10); // generous limit; UI truncates display
        db.prepare(
          "UPDATE sessions SET title = ? WHERE id = ? AND is_manual_title = 0"
        ).run(title, sessionId);
      }
    } catch (error) {
      console.error("Title generation failed:", error);
    }
  }

  // ─── Ollama proxy ─────────────────────────────────────────────────────────
  app.post("/api/ai/ollama", async (req, res) => {
    const ollamaUrl = process.env.OLLAMA_API_BASE_URL || "http://localhost:11434";
    if (!isValidString(req.body.prompt, 8_000)) {
      return res.status(400).json({ error: "Prompt too long or missing" });
    }
    try {
      const response = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "llama3.2:3b",
          prompt: req.body.prompt,
          stream: false,
          system: typeof req.body.system === 'string' ? req.body.system.substring(0, 2000) : ""
        }),
      });
      if (!response.ok) throw new Error("Ollama error");
      const data = await response.json();
      res.json(data);
    } catch {
      res.status(503).json({ error: "Ollama service unavailable" });
    }
  });

  // ─── Ollama status ────────────────────────────────────────────────────────
  app.get("/api/ai/ollama/status", async (_req, res) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (response.ok) {
        // Just verify connectivity; we can also return tags or version if needed
        res.json({ status: "online" });
      } else {
        res.json({ status: "offline" });
      }
    } catch {
      res.json({ status: "offline" });
    }
  });

  // ─── NVIDIA key verification ──────────────────────────────────────────────
  // Uses the SERVER-SIDE env key — the frontend no longer needs to send the raw key.
  app.post("/api/ai/nvidia/verify", async (req, res) => {
    // Accept an optional client-supplied key; fall back to server env key
    const apiKey = (typeof req.body.apiKey === 'string' && req.body.apiKey.trim())
      ? req.body.apiKey.trim()
      : process.env.NVIDIA_API_KEY;

    if (!apiKey) return res.status(400).json({ valid: false, error: "No API key available" });
    if (apiKey.length > 512) return res.status(400).json({ valid: false, error: "Key too long" });

    try {
      const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "meta/llama-3.1-8b-instruct",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1
        }),
      });
      if (response.ok) {
        res.json({ valid: true });
      } else {
        const err = await response.json().catch(() => ({}));
        res.status(401).json({ valid: false, error: (err as any)?.error?.message || "Invalid Key" });
      }
    } catch {
      res.status(500).json({ valid: false, error: "Connection failed" });
    }
  });

  // ─── NVIDIA Compatibility Route ───────────────────────────────────────────
  // Proxy older frontends calling /api/ai/nvidia to the unified chat logic
  app.post("/api/ai/nvidia", (req, res) => {
    // Simply redirect/re-route to the unified chat handler
    req.url = '/api/ai/chat';
    app._router.handle(req, res, () => {});
  });

  // ─── Groq proxy ───────────────────────────────────────────────────────────
  app.post("/api/ai/groq", async (req, res) => {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) return res.status(503).json({ error: "GROQ_API_KEY not configured" });
    if (!isValidString(req.body.prompt, 8_000)) {
      return res.status(400).json({ error: "Prompt too long or missing" });
    }

    try {
      const messages = req.body.messages || [
        ...(req.body.system ? [{ role: "system", content: req.body.system }] : []),
        { role: "user", content: req.body.prompt }
      ];
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqApiKey}`
        },
        body: JSON.stringify({
          model: req.body.model || "llama-3.1-8b-instant",
          messages,
          temperature: 0.7,
          max_tokens: 2048,
        }),
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Groq error: ${err}`);
      }
      const data = await response.json();
      res.json({ response: data.choices[0]?.message?.content || "", provider: "groq" });
    } catch (error: any) {
      console.error("Groq error:", error);
      res.status(503).json({ error: error.message || "Groq service unavailable" });
    }
  });

  // ─── Unified smart chat ───────────────────────────────────────────────────
  app.post("/api/ai/chat", async (req, res) => {
    const ollamaUrl = process.env.OLLAMA_API_BASE_URL || "http://localhost:11434";
    const groqApiKey = process.env.GROQ_API_KEY;
    const nvidiaKey  = process.env.NVIDIA_API_KEY;

    // Handle both old 'prompt' string and new 'messages' array formats
    const { mode } = req.body;
    const messages = req.body.messages || [];
    let textPrompt = req.body.prompt || "";

    // Determine system prompt based on mode
    let systemInstruction = req.body.system; // Allow override from request
    if (!systemInstruction) {
      if (mode === 'symptoms') {
        systemInstruction = SYMPTOM_SYSTEM_PROMPT;
      } else if (mode === 'chat') {
        systemInstruction = CHAT_SYSTEM_PROMPT;
      }
    }
    
    // If no explicit prompt string, try to extract from the last user message
    if (!textPrompt && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      textPrompt = typeof lastMsg.content === 'string' 
        ? lastMsg.content 
        : (lastMsg.content.find((c: any) => c.type === 'text')?.text || "");
    }

    // Safety: prevent obvious abuse, but allow large image payloads in 'messages' array
    if (!textPrompt && messages.length === 0) {
      return res.status(400).json({ error: "No prompt or messages provided" });
    }

    // 1. Try Ollama first (local, fastest, free)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const statusRes = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (statusRes.ok) {
        // Ollama usually takes string prompts. We pass the extracted text.
        const genRes = await fetch(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: "llama3.2:3b",
            prompt: textPrompt.substring(0, 8000), 
            stream: false,
            system: systemInstruction || ""
          }),
        });
        if (genRes.ok) {
          const data = await genRes.json();
          return res.json({ ...data, provider: "ollama" });
        }
      }
    } catch (_) { /* Ollama unavailable */ }

    // 2. Fallback: Groq (free tier)
    if (groqApiKey) {
      try {
        const groqMessages = messages.length > 0 ? messages : [
          { role: "user", content: textPrompt }
        ];

        // Prepend system instruction if not already present in history
        const finalGroqMessages = [
          ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
          ...groqMessages
        ];
        
        // Remove image URLs from Groq as it (typically) doesn't support vision in this free endpoint
        const safeGroqMessages = groqMessages.map((m: any) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content.find((c: any) => c.type === 'text')?.text || "IMAGE_OMITTED"
        }));

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqApiKey}` },
          body: JSON.stringify({ model: req.body.model || "llama-3.1-70b-versatile", messages: finalGroqMessages, temperature: 0.7, max_tokens: 2048 }),
        });
        if (groqRes.ok) {
          const data = await groqRes.json();
          return res.json({ response: data.choices[0]?.message?.content || "", provider: "groq" });
        }
      } catch (_) { /* Groq unavailable */ }
    }

    // 3. Fallback: NVIDIA NIM
    if (nvidiaKey) {
      try {
        const nvMessages = messages.length > 0 ? messages : [
          { role: "user", content: textPrompt }
        ];
        
        const nvModel = req.body.model || (messages.some((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url')) 
          ? "meta/llama-3.2-90b-vision-instruct" 
          : "meta/llama-3.1-70b-instruct");

        const nvRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${nvidiaKey}` },
          body: JSON.stringify({ 
            model: nvModel, 
            messages: [
              ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
              ...nvMessages
            ], 
            temperature: 0.7, 
            max_tokens: 2048 
          }),
        });
        
        if (nvRes.ok) {
          const data = await nvRes.json();
          return res.json({ response: data.choices[0]?.message?.content || "", provider: "nvidia" });
        } else {
           console.error("NVIDIA API failed:", await nvRes.text());
        }
      } catch (_) { /* NVIDIA unavailable */ }
    }

    return res.status(503).json({ error: "All AI services unavailable or timed out" });
  });

  // ─── README viewer ────────────────────────────────────────────────────────
  app.get("/api/readme", async (_req, res) => {
    // Resolve path and ensure it stays within the project root (path-traversal guard)
    const projectRoot = path.resolve(process.cwd());
    const readmePath  = path.resolve(projectRoot, 'README.md');

    if (!readmePath.startsWith(projectRoot)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    try {
      const content = await fs.readFile(readmePath, 'utf-8');
      res.json({ content });
    } catch {
      res.status(500).json({ error: "Failed to read README.md" });
    }
  });

  // ─── Vite dev / production static ────────────────────────────────────────
  let vite: any;
  if (process.env.NODE_ENV !== "production") {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath, { dotfiles: 'deny' }));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  if (vite) {
    server.on('upgrade', (req, socket, head) => {
      vite.ws.handleUpgrade(req, socket, head);
    });
  }
}

startServer();
