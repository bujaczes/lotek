# Stage 1 — build the frontend
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 — runtime (server + built dist only)
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
# better-sqlite3 compiles a native binding: install toolchain just for npm ci, then drop it
RUN apk add --no-cache --virtual .build python3 make g++ \
 && npm ci --omit=dev \
 && apk del .build
COPY server.js ./server.js
COPY src/server ./src/server
COPY db/schema.sql ./db/schema.sql
COPY db/index.js ./db/index.js
COPY scripts ./scripts
# COPY config ./config
COPY data/fixtures ./data/fixtures
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
ENV PORT=80
ENV DB_PATH=/app/db/lotek.db
EXPOSE 80
CMD ["node", "server.js"]
