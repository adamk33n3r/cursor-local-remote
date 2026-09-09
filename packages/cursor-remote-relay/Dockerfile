FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY bin ./bin
COPY lib ./lib
COPY src ./src
COPY next.config.mjs postcss.config.mjs tsconfig.json ./
RUN npx next build
EXPOSE 3200
ENTRYPOINT ["node", "bin/cursor-remote-relay.mjs"]
