FROM node:20-bookworm-slim AS deps

WORKDIR /app

COPY package.json ./
RUN npm install --no-package-lock

FROM deps AS source

WORKDIR /app
COPY . .

FROM source AS api

ENV NODE_ENV=development
ENV PORT=3001
ENV API_PORT=3001

EXPOSE 3001

CMD ["node", "api/server.js"]

FROM source AS dev

ENV NODE_ENV=development

EXPOSE 5173

CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5173"]

FROM source AS build

ARG VITE_API=""
ARG VITE_API_BASE_URL="http://127.0.0.1:3001"
ARG VITE_DEFAULT_AUTHENTICATED_VIEW="/visualizer"
ARG VITE_OPENROUTER_API_KEY="your_api_key_here"
ARG VITE_REOWN_PROJECT_ID="your_reown_project_id_here"
ARG VITE_S3_BUCKET="https://s3.us-west-1.amazonaws.com/bucket"
ARG VITE_SOCKET_URL="ws://127.0.0.1:3001"

ENV NODE_ENV=production
ENV VITE_API=$VITE_API
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_DEFAULT_AUTHENTICATED_VIEW=$VITE_DEFAULT_AUTHENTICATED_VIEW
ENV VITE_OPENROUTER_API_KEY=$VITE_OPENROUTER_API_KEY
ENV VITE_REOWN_PROJECT_ID=$VITE_REOWN_PROJECT_ID
ENV VITE_S3_BUCKET=$VITE_S3_BUCKET
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL

RUN npm run build

FROM deps AS start

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js

ENV NODE_ENV=production
ENV PORT=2223

EXPOSE 2223

CMD ["node", "server.js"]
