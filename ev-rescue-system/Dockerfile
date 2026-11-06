FROM node:20-alpine

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/ ./
COPY admin-dashboard/ /app/admin-dashboard/

ENV NODE_ENV=production
ENV PORT=3108
ENV RESCUE_DB_FILE=/data/rescue.json
ENV UPLOAD_DIR=/data/uploads

RUN mkdir -p /data/uploads && chown -R node:node /app /data

USER node

EXPOSE 3108

CMD ["node", "server.js"]
