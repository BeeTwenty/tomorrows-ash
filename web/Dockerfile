# ---------------------------------------------------------------------------
# Tomorrow's Ash - website image
#
# Multi-stage so the runtime image carries the built server and nothing else:
# no source, no dev dependencies, no package manager cache.
#
#   docker build -t tomorrows-ash-web ./web
#   docker run --rm -p 3000:3000 --env-file web/.env.local tomorrows-ash-web
#
# The image deliberately contains NO configuration. Everything - database
# credentials, session secret, realm address - arrives as environment
# variables at run time, so the same image is safe to push anywhere.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# SITE_URL is baked into the metadata of statically rendered pages (the wiki
# and patch notes). Pass it at build time for correct canonical URLs; every
# page that reads the realm database is rendered per request and does not
# depend on it.
ARG SITE_URL=http://localhost:3000
ENV SITE_URL=$SITE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run unprivileged. The node image ships a `node` user for exactly this.
RUN chown -R node:node /app
USER node

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/content ./content

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
