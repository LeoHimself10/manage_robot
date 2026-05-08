FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY AGENTS.md ./
COPY docs ./docs/
COPY src ./src
COPY scripts ./scripts

EXPOSE 8080

CMD ["npx", "tsx", "src/dingtalk-bot.ts"]
