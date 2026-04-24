FROM node:20-alpine AS runtime

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

COPY --chown=node:node index.js ./
COPY --chown=node:node src ./src

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3100

USER node

EXPOSE 3100

CMD ["node", "index.js"]
