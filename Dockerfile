FROM node:22

WORKDIR /app

COPY ./ /app/

EXPOSE 5432

ENV PORT=5432

CMD ["node", "server.js"]
