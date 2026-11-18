# ---- builder stage ----
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ---- runtime stage ----
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

# sharp draws the text in the bot's pictures (the Birthday banner, the Challenge pictures)
# through fontconfig, and the slim image has neither fontconfig nor any font: without them
# every letter comes out as an empty box. The club's print fonts, Anton and Barlow
# Condensed (OFL), ship in src/assets/fonts and are registered below; DejaVu is the
# fallback for any other family.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/build ./build
COPY --from=builder /app/src/assets ./src/assets
COPY --from=builder /app/src/assets/fonts /usr/local/share/fonts/therpgclub
RUN fc-cache -f

RUN useradd --uid 1001 --create-home botuser
USER botuser

CMD ["node", "build/RPGClub_GameDB.js"]
