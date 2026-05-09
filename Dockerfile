FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY AGENTS.md ./
COPY docs ./docs/
COPY fixtures ./fixtures/
COPY src ./src
COPY scripts ./scripts

RUN chmod +x ./scripts/docker-entrypoint-dingtalk.sh

EXPOSE 8080

CMD ["./scripts/docker-entrypoint-dingtalk.sh"]
