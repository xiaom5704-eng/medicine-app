# 智慧醫療助理 (MedSafe AI)

這是一個結合本地端 AI (Ollama) 與雲端 AI (Gemini) 的智慧醫療助理，支援藥物辨識、翻譯分析與症狀諮詢。

## 🌟 特色功能
- **混合式 AI 引擎**：優先連線本地 Ollama (Llama 3.2)，連線失敗時自動切換至 Google Gemini API。
- **藥物辨識**：上傳藥袋或藥瓶照片，自動翻譯並分析藥物成分與風險。
- **症狀諮詢**：提供專業的兒科醫療建議（僅供參考，緊急情況請就醫）。
- **PWA 支援**：可安裝於 Windows 10/11 桌面或手機主畫面，像原生 App 一樣使用。
- **隱私優先**：使用 Ollama 模式時，所有對話均在本地處理，不外傳雲端。

---

## 🚀 如何在本地啟動 (推薦)

如果您想在自己的電腦上免費執行 AI，請確保已安裝 **Docker**。

1. **複製專案**：
   ```bash
   git clone <您的 GitHub 專案網址>
   cd <專案資料夾>
   ```

2. **一鍵啟動**：
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```

3. **開始使用**：
   打開瀏覽器訪問 `http://localhost:3000`。
   *提示：第一次啟動會自動下載 Llama 3.2 模型 (約 2GB)，請耐心等候。*

---

## 🌐 如何部屬到雲端 (給別人用)

如果您希望產生一個網址讓別人直接點開使用：

### 1. 部屬至 Google Cloud Run (推薦)
本專案已內建 `Dockerfile`，您可以直接連接 GitHub 儲存庫至 Google Cloud Run 進行自動部屬。

### 2. 設定環境變數
在雲端平台設定以下環境變數：
- `GEMINI_API_KEY`: 您的 Google AI Studio 金鑰 (選填，若無 Ollama 時使用)。

### 3. 使用者端安裝
使用者點開網址後，可以點擊瀏覽器網址列的「安裝」圖示，將其安裝至 Windows 或手機。

---

## 🖥️ 如何製作桌面版 (.exe)

如果您希望將此程式打包成一個可下載的 Windows 安裝檔：

1. **環境準備**：
   - 確保您的電腦已安裝 [Node.js](https://nodejs.org/)。
   - 下載並安裝 [Ollama](https://ollama.com/)。

2. **設定 Ollama 權限 (重要)**：
   - 為了讓桌面 App 能存取本地 AI，請先關閉 Ollama。
   - **Windows**: 在 PowerShell 執行 `[System.Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', '*', 'User')`，然後重新啟動 Ollama。
   - **Mac**: 執行 `launchctl setenv OLLAMA_ORIGINS "*"`，然後重新啟動 Ollama。

3. **打包程式**：
   ```bash
   npm install
   npm run electron:build
   ```
   - 打包完成後，安裝檔會出現在 `release` 資料夾中。

---

## 🛠️ 技術棧
- **Frontend**: React + Vite + Tailwind CSS + Framer Motion
- **Backend**: Express + SQLite (Better-SQLite3)
- **AI**: Ollama (Llama 3.2:3b) & Google Gemini API
- **Container**: Docker & Docker Compose

---

## ⚠️ 免責聲明
本程式提供的醫療建議僅供參考，不能替代專業醫生的診斷。如有緊急醫療需求，請立即撥打急救電話或前往醫院。
