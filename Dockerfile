FROM node:22

WORKDIR /app

COPY ./ /app/

EXPOSE 5432

CMD ["node", "server.js"]
