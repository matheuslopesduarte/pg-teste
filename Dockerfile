FROM node:20-alpine

WORKDIR /app

COPY proxy.js /app/proxy.js

EXPOSE 6432

CMD ["node", "proxy.js"]
