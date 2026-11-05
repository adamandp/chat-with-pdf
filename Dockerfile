FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# The existing lockfile contains Nest peer ranges that do not overlap.
RUN npm ci --legacy-peer-deps
COPY . .
RUN npx prisma generate --config prisma7.config.ts && npm run build

FROM build AS migrate
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
CMD ["npx", "prisma", "migrate", "deploy", "--config", "prisma7.config.ts"]

FROM build AS production-dependencies
RUN npm prune --omit=dev --legacy-peer-deps

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir logs && chown node:node logs
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
