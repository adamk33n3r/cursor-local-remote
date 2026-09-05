FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY lib ./lib
EXPOSE 3200
ENTRYPOINT ["node", "bin/cursor-remote-relay.mjs"]
