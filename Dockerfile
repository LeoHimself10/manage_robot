FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build:workbench-login && npm prune --omit=dev

ENV NODE_ENV=production

COPY AGENTS.md ./
COPY docs ./docs/
COPY fixtures ./fixtures/
COPY scripts ./scripts

RUN chmod +x ./scripts/docker-entrypoint-dingtalk.sh

EXPOSE 8080

CMD ["./scripts/docker-entrypoint-dingtalk.sh"]
