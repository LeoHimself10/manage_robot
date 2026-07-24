FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build:workbench-login && npm run build:workbench-draft-grid && npm run build:performance-chat-markdown && npm prune --omit=dev

ENV NODE_ENV=production

COPY AGENTS.md ./
COPY docs ./docs/
COPY fixtures ./fixtures/
COPY scripts ./scripts

RUN sed -i 's/\r$//' ./scripts/docker-entrypoint-dingtalk.sh \
    && chmod +x ./scripts/docker-entrypoint-dingtalk.sh

EXPOSE 8080

CMD ["./scripts/docker-entrypoint-dingtalk.sh"]
