import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("medsafe.db");

// Initialize database
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
    role TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  );
`);

// Migration for existing databases
try {
  db.exec("ALTER TABLE sessions ADD COLUMN is_pinned INTEGER DEFAULT 0");
} catch (e) {}
try {
  db.exec("ALTER TABLE sessions ADD COLUMN is_manual_title INTEGER DEFAULT 0");
} catch (e) {}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get("/api/sessions", (req, res) => {
    // Sort logic: pinned first, then by date
    const sessions = db.prepare("SELECT * FROM sessions ORDER BY is_pinned DESC, created_at DESC").all();
    res.json(sessions);
  });

  app.post("/api/sessions", (req, res) => {
    const { id, title } = req.body;
    db.prepare("INSERT INTO sessions (id, title, is_pinned, is_manual_title) VALUES (?, ?, 0, 0)").run(id, title);
    res.json({ success: true });
  });

  app.patch("/api/sessions/:id", (req, res) => {
    const { title, is_pinned, is_manual_title } = req.body;
    if (title !== undefined) {
      db.prepare("UPDATE sessions SET title = ?, is_manual_title = ? WHERE id = ?").run(title, is_manual_title ?? 1, req.params.id);
    }
    if (is_pinned !== undefined) {
      db.prepare("UPDATE sessions SET is_pinned = ? WHERE id = ?").run(is_pinned ? 1 : 0, req.params.id);
    }
    res.json({ success: true });
  });

  app.get("/api/messages/:sessionId", (req, res) => {
    const messages = db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(req.params.sessionId);
    res.json(messages);
  });

  app.post("/api/messages", (req, res) => {
    const { session_id, role, content } = req.body;
    db.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)").run(session_id, role, content);
    res.json({ success: true });
  });

  app.delete("/api/sessions/:id", (req, res) => {
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(req.params.id);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Ollama Proxy
  app.post("/api/ai/ollama", async (req, res) => {
    const ollamaUrl = process.env.OLLAMA_API_BASE_URL || "http://localhost:11434";
    try {
      const response = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "llama3.2:3b",
          prompt: req.body.prompt,
          stream: false,
          system: req.body.system || ""
        }),
      });
      if (!response.ok) throw new Error("Ollama error");
      const data = await response.json();
      res.json(data);
    } catch (error) {
      res.status(503).json({ error: "Ollama service unavailable" });
    }
  });

  // Check Ollama status
  app.get("/api/ai/ollama/status", async (req, res) => {
    const ollamaUrl = process.env.OLLAMA_API_BASE_URL || "http://localhost:11434";
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        const data = await response.json();
        const modelName = data.models && data.models.length > 0 ? data.models[0].name : "Unknown";
        res.json({ status: "online", model: modelName });
      } else {
        res.json({ status: "offline" });
      }
    } catch (error) {
      res.json({ status: "offline" });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
