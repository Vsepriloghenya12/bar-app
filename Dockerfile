FROM node:20-slim

WORKDIR /app

# Копим только манифесты
COPY backend/package*.json ./backend/

WORKDIR /app/backend
RUN npm install --omit=dev

WORKDIR /app

# Копируем весь проект
COPY . .

# Railway передаёт порт через $PORT
ENV PORT=8080

WORKDIR /app/backend
CMD ["node", "server.cjs"]
