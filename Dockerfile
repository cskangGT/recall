# One process, one origin: the built client and the API together, so no CORS
# header is ever needed on a service holding somebody's corpus.
#
# Node 22 is not a preference. server/db/sqlite.ts uses `node:sqlite`, and the
# server runs TypeScript directly through Node's type stripping — both arrived
# in 22, which is why package.json pins the engine.
FROM node:22-slim

WORKDIR /app

# Dependencies first, so a source change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# The built client must reach for the API rather than the bundled fixture. See
# selectDataSource: without this the deployment serves 47 hard-coded memories
# and looks entirely functional.
ENV VITE_API_DEFAULT=1
RUN npm run build

# A volume belongs here. RECALL_DB defaults to :memory:, which on a server means
# every visitor's corpus disappears with the next deploy.
ENV RECALL_DB=/data/recall.db
ENV RECALL_STATIC=/app/dist
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/http/main.ts"]
