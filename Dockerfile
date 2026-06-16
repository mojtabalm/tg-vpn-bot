FROM node:22-alpine
WORKDIR /app
COPY bot/package.json ./package.json
RUN npm install
COPY bot/ .
EXPOSE 8080
CMD ["node", "--experimental-sqlite", "index.js"]
