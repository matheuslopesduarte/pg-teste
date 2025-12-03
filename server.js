import isRedis from "./detectors/redis.js";
import isPostgres from "./detectors/postgres.js";
import net from "net";
import { PORT } from "./data.js";
import handleRedis from "./handlers/redis.js";
import handlePostgres from "./handlers/postgres.js";

const server = net.createServer((clientSocket) => {
  clientSocket.setNoDelay(true);

  let detectBuffer = Buffer.alloc(0);

  clientSocket.on("data", (chunk) => {
    detectBuffer = Buffer.concat([detectBuffer, chunk]);

    if (isRedis(detectBuffer)) {
      clientSocket.removeAllListeners("data");
      return handleRedis(clientSocket, detectBuffer);
    }

    if (detectBuffer.length >= 8) {
      const len = detectBuffer.readInt32BE(0);
      if (len >= 8 && len <= 100000) {
        clientSocket.removeAllListeners("data");
        return handlePostgres(clientSocket, detectBuffer);
      }
    }

    if (detectBuffer.length > 32) {
      clientSocket.end("ERR: protocolo desconhecido\n");
    }
    console.log(detectBuffer);
  });
});

server.listen(PORT, () => {
  console.log(`[PROXY] Proxy Multi (PG + Redis) escutando em ${PORT}`);
});
