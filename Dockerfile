# Telegram-бот: образ для Railway
FROM node:20-alpine

WORKDIR /app

# Копируем только файлы зависимостей
COPY package.json package-lock.json* ./

# Устанавливаем зависимости (без dev)
RUN npm ci --omit=dev

# Копируем исходный код
COPY src ./src

# Переменные окружения задаются в Railway (TELEGRAM_BOT_TOKEN, API_BASE_URL)
ENV NODE_ENV=production

CMD ["node", "src/index.js"]
