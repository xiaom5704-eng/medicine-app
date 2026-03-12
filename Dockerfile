FROM node:20-alpine

WORKDIR /app

# 安裝編譯 better-sqlite3 可能需要的工具
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

# 設定環境變數
ENV NODE_ENV=production

CMD ["npm", "start"]
