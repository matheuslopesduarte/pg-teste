FROM node:20-alpine

WORKDIR /app

COPY proxy.js /app/proxy.js

CMD ["node", "proxy.js"]
