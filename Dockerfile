FROM node:20-alpine

WORKDIR /app

COPY ./ /app/

EXPOSE 1022

ENV PORT=1022

CMD ["node", "server.js"]
