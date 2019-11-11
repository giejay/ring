FROM node:10

RUN mkdir -p /app/server

WORKDIR /app

COPY package.json /app/package.json

RUN npm install

COPY lib/api /app/api

COPY lib/examples/get-snapshot.js /app/server/index.js

CMD ["node", "/app/server/index.js"]
