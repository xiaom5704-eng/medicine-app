#!/bin/bash

# 檢查 Docker 是否安裝
if ! [ -x "$(command -v docker)" ]; then
  echo '錯誤：未安裝 Docker。請先安裝 Docker。' >&2
  exit 1
fi

# 檢查 Docker Compose 是否安裝
if ! [ -x "$(command -v docker-compose)" ]; then
  echo '錯誤：未安裝 Docker Compose。請先安裝 Docker Compose。' >&2
  exit 1
fi

echo "🚀 正在啟動智慧醫療助理 (Docker 一鍵啟動方案)..."

# 啟動服務
docker-compose up --build -d

echo ""
echo "✅ 啟動指令已送出！"
echo "-------------------------------------------------------"
echo "應用程式網址: http://localhost:3000"
echo "Ollama 服務網址: http://localhost:11434 (內部容器連線使用 ollama-service:11434)"
echo "-------------------------------------------------------"
echo "提示：第一次啟動時，ollama-service 會在背景下載 llama3.2:3b 模型，請稍候幾分鐘。"
echo "你可以使用 'docker-compose logs -f ollama-service' 查看下載進度。"
