FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci -w server --include-workspace-root
COPY server server
RUN npm run build -w server
WORKDIR /app/server
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/server.js"]
