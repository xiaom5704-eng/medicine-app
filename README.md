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

## 🌐 如何部署到雲端 (給別人用)

如果您希望產生一個網址讓別人直接點開使用，我們已配置好支援 **Heroku** 的部署環境。

### 部署至 Heroku 的步驟

1. **註冊並安裝 Heroku CLI**：
   請前往 [Heroku 官網](https://heroku.com/) 註冊帳號，並下載安裝 [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli)。

2. **登入 Heroku**：
   打開終端機 (Terminal 或 PowerShell)，執行：
   ```bash
   heroku login
   ```

3. **建立 Heroku App**：
   在專案資源夾底下執行：
   ```bash
   heroku create <您自訂的App名稱(可留空由系統隨機建立)>
   ```

4. **設定環境變數**：
   請將您從 NVIDIA 取得的 API Key 設定到 Heroku 環境變數中：
   ```bash
   heroku config:set NVIDIA_API_KEY="您的_NVIDIA_API_KEY"
   ```

5. **推播程式碼至 Heroku**：
   ```bash
   git add .
   git commit -m "Prepare for Heroku deployment"
   git push heroku main
   ```

6. **開啟網頁**：
   部署完成後，執行以下指令即可自動在瀏覽器開啟您的 App：
   ```bash
   heroku open
   ```

> ⚠️ **溫馨提示**：
> 部署至 Heroku 的免費版本 (EcoDynos) 或是展示版，每天都有硬性重啟的機制，且不提供持久化的檔案系統。這代表每一次重啟，您的 SQLite (`medsafe.db`) 都會被清空，**對話紀錄將無法永久保留**。
> 使用者端可以點擊瀏覽器網址列的「安裝」圖示，將其安裝至 Windows 或手機 (PWA支援)。

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

## 🛠️ 開發者指南

### 安裝與啟動
1. 確保已安裝 Node.js (v20+)
2. 安裝套件：`npm install`
3. 啟動開發伺服器：`npm run dev` (包含 Vite 前端與 Express 後端)

### 相關腳本
- `npm run build`: 同時編譯前端與後端伺服器檔案。
- `npm run electron:dev`: 啟動 Electron 開發環境。
- `npm run electron:build`: 打包 Windows 安裝檔。

## 🤖 CI/CD 與自動化
本專案使用 GitHub Actions 定義了自動化工作流 (.github/workflows/main.yml)：
- **自動化測試與編譯**：每當 `push` 或 `Pull Request` 到 `main` 分支時，會自動執行 `npm install` 與 `npm run build`。
- **Docker 檢查**：自動檢查 Dockerfile 是否能正確編譯，確保部署穩定性。

---

## 🏗️ 技術棧
- **Frontend**: React 19 + Vite 6 + Tailwind CSS 4 + Framer Motion
- **Backend**: Express + SQLite (Better-SQLite3)
- **AI**: Ollama (Llama 3.2:3b) & Google Gemini API
- **Container**: Docker & Docker Compose
- **CI/CD**: GitHub Actions
- **Desktop**: Electron 41

---

## ⚠️ 免責聲明
本程式提供的醫療建議僅供參考，不能替代專業醫生的診斷。如有緊急醫療需求，請立即撥打急救電話或前往醫院。
