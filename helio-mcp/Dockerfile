# helio-mcp over Streamable HTTP (HEL-1709). Build context is this directory:
#   docker build -t helio-mcp helio-mcp
# Runs `dist/http.js` as the unprivileged `node` user; configuration is environment variables only
# (see README.md). Nothing secret is baked into the image.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# tsconfig.build.json excludes tests; a build failure fails the image (never masked).
RUN npm run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/http.js"]
