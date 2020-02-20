FROM node:10

RUN mkdir -p /app/server

WORKDIR /app

COPY package.json /app/package.json

RUN npm install

RUN apt-get update

RUN apt-get -y install ffmpeg

COPY lib/api /app/api

COPY public/index.html /app/public/index.html

COPY lib/examples/get-snapshot.js /app/server/index.js

CMD ["node", "/app/server/index.js"]
