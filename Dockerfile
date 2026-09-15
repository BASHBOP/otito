FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
ENTRYPOINT ["node", "src/cli.js", "mcp"]
