FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# Official Linux Agent is a glibc binary. Alpine (musl) execs it as "not found" (127).
ENV PATH="/root/.local/bin:${PATH}"
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/* \
  && curl https://cursor.com/install -fsS | bash
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/.next ./.next
COPY --from=build /app/bin ./bin
COPY --from=build /app/public ./public
COPY --from=build /app/src/lib/merge-known-workspaces.mjs ./src/lib/merge-known-workspaces.mjs
COPY --from=build /app/src/lib/list-session-workspaces.mjs ./src/lib/list-session-workspaces.mjs
COPY --from=build /app/src/lib/cursor-project-cache.mjs ./src/lib/cursor-project-cache.mjs
COPY --from=build /app/next.config.mjs ./
RUN mkdir -p /workspace
EXPOSE 3100
WORKDIR /workspace
# Bind 0.0.0.0:3100 and AUTH_TOKEN are already CLI defaults. Do not open a
# browser inside the container; QR still prints if a LAN IP is detected.
ENTRYPOINT ["node", "/app/bin/cursor-remote.mjs"]
CMD ["--no-open"]
