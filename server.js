import isRedis from "./detectors/redis.js";
import isPostgres from "./detectors/postgres.js";
import isAMQP from "./detectors/amqp.js";
import net from "net";
import { PORT } from "./data.js";
import handleRedis from "./handlers/redis.js";
import handlePostgres from "./handlers/postgres.js";
import handleAMQP from "./handlers/ampq.js";

const server = net.createServer((clientSocket) => {
  clientSocket.setNoDelay(true);

  let detectBuffer = Buffer.alloc(0);

  clientSocket.on("data", (chunk) => {
    detectBuffer = Buffer.concat([detectBuffer, chunk]);

    if (isRedis(detectBuffer)) {
      console.log("[PROXY] Redis DETECTED from user: " + clientSocket.remoteAddress);

      clientSocket.removeAllListeners("data");
      return handleRedis(clientSocket, detectBuffer);
    }

    if (isPostgres(detectBuffer)) {
      console.log("[PROXY] Postgres DETECTED from user: " + clientSocket.remoteAddress);

      clientSocket.removeAllListeners("data");
      return handlePostgres(clientSocket, detectBuffer);
    }

    if (isAMQP(detectBuffer)) {
      console.log("[PROXY] AMQP DETECTED from user: " + clientSocket.remoteAddress + " - não suportado");

      clientSocket.removeAllListeners("data");
      return handleAMQP(clientSocket, detectBuffer);
    }

    clientSocket.end("ERR: protocolo não suportado pelo fabroku proxy\n");

    console.log(detectBuffer);
  });
});

server.listen(PORT, () => {
  console.log(`[PROXY] Proxy Multi (PG + Redis) escutando em ${PORT}`);
});
