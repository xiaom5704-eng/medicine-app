const { app, BrowserWindow } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const { fork } = require('child_process');

let mainWindow;
let serverProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "智慧醫療助理",
    icon: path.join(__dirname, '../public/favicon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // 1. 啟動後端伺服器 (Express)
  // 在開發模式下，我們假設伺服器已經由 npm run dev 啟動
  // 在生產模式下，我們啟動打包好的 server.js
  if (!isDev) {
    serverProcess = fork(path.join(__dirname, '../dist-server/server.js'), [], {
      env: { NODE_ENV: 'production', PORT: 3000 }
    });
  }

  // 2. 載入介面
  const startURL = isDev 
    ? 'http://localhost:3000' 
    : `file://${path.join(__dirname, '../dist/index.html')}`;

  mainWindow.loadURL(startURL);

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (serverProcess) serverProcess.kill();
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// 確保關閉程式時，後端伺服器也會被關閉
app.on('quit', () => {
  if (serverProcess) serverProcess.kill();
});
