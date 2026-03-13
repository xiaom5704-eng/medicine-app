import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

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
    const sessions = db.prepare(
      "SELECT * FROM sessions ORDER BY is_pinned DESC, created_at DESC"
    ).all();
    res.json(sessions);
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

    db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    res.json({ success: true });
  });

  // ─── Messages ─────────────────────────────────────────────────────────────
  app.get("/api/messages/:sessionId", (req, res) => {
    const sessionId = req.params.sessionId;
    if (!isValidId(sessionId)) return res.status(400).json({ error: "Invalid session ID" });

    const messages = db.prepare(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC"
    ).all(sessionId);
    res.json(messages);
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

    // Auto-generate title on first assistant reply
    if (role === 'assistant') {
      const msgCount = (db.prepare(
        "SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?"
      ).get(session_id) as any).cnt;

      if (msgCount === 2) {
        const session = db.prepare(
          "SELECT is_manual_title FROM sessions WHERE id = ?"
        ).get(session_id) as any;

        if (session && !session.is_manual_title) {
          const apiKey = process.env.NVIDIA_API_KEY || '';
          generateChatTitle(session_id, apiKey).catch(console.error);
        }
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
        const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
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
          title = data.choices[0]?.message?.content?.trim().replace(/[「」『』""]/g, '') ?? '';
        }
      }

      if (!title) {
        const ollamaUrl = process.env.OLLAMA_API_BASE_URL || "http://localhost:11434";
        const response = await fetch(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: "llama3.2:3b", prompt, stream: false }),
        });
        if (response.ok) {
          const data = await response.json();
          title = data.response?.trim().replace(/[「」『』""]/g, '') ?? '';
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
    const ollamaUrl = process.env.OLLAMA_API_BASE_URL || "http://localhost:11434";
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const [verRes] = await Promise.all([
        fetch(`${ollamaUrl}/api/version`, { signal: controller.signal }),
        fetch(`${ollamaUrl}/api/tags`,   { signal: controller.signal })
      ]);
      clearTimeout(timeoutId);
      if (verRes.ok) {
        const verData = await verRes.json();
        res.json({ status: "online", version: verData.version });
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
    } catch (error) {
      console.error("Groq error:", error);
      res.status(503).json({ error: "Groq service unavailable" });
    }
  });

  // ─── Unified smart chat ───────────────────────────────────────────────────
  app.post("/api/ai/chat", async (req, res) => {
    const ollamaUrl = process.env.OLLAMA_API_BASE_URL || "http://localhost:11434";
    const groqApiKey = process.env.GROQ_API_KEY;
    const nvidiaKey  = process.env.NVIDIA_API_KEY;

    if (!isValidString(req.body.prompt, 8_000)) {
      return res.status(400).json({ error: "Prompt too long or missing" });
    }

    // 1. Try Ollama first (local, fastest, free)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const statusRes = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (statusRes.ok) {
        const genRes = await fetch(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: "llama3.2:3b",
            prompt: req.body.prompt,
            stream: false,
            system: typeof req.body.system === 'string' ? req.body.system.substring(0, 2000) : ""
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
        const messages = [
          ...(req.body.system ? [{ role: "system", content: req.body.system }] : []),
          { role: "user", content: req.body.prompt }
        ];
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqApiKey}` },
          body: JSON.stringify({ model: "llama-3.1-8b-instant", messages, temperature: 0.7, max_tokens: 2048 }),
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
        const messages = [
          ...(req.body.system ? [{ role: "system", content: req.body.system }] : []),
          { role: "user", content: req.body.prompt }
        ];
        const nvRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${nvidiaKey}` },
          body: JSON.stringify({ model: "meta/llama-3.1-8b-instruct", messages, temperature: 0.7, max_tokens: 2048 }),
        });
        if (nvRes.ok) {
          const data = await nvRes.json();
          return res.json({ response: data.choices[0]?.message?.content || "", provider: "nvidia" });
        }
      } catch (_) { /* NVIDIA unavailable */ }
    }

    return res.status(503).json({ error: "All AI services unavailable" });
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
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
