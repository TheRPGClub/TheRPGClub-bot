# ---- builder stage ----
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ---- runtime stage ----
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/build ./build

RUN useradd --uid 1001 --create-home botuser
USER botuser

CMD ["node", "build/RPGClub_GameDB.js"]
