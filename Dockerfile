FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV PORT=21128 HOST=0.0.0.0 DATA_DIR=/app/data
EXPOSE 21128
VOLUME ["/app/data"]
CMD ["node", "src/server.js"]
