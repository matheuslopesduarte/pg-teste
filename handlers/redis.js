import parseRedisAuth from "../helpers/redis/parseRedisAuth.js";
import { HOST_REGEX, REDIS_TARGET_PORT } from "../data.js";
import net from "net";

function handleRedis(clientSocket, firstChunk) {

  const passRaw = parseRedisAuth(firstChunk);
  if (!passRaw) {
    clientSocket.end(
      "-ERR Formato AUTH inválido. Use AUTH container:senha\r\n"
    );
    return;
  }

  const [container, password] = passRaw.split(":");

  if (!container || !password) {
    clientSocket.end("-ERR Formato: AUTH container:senha\r\n");
    return;
  }

  if (!HOST_REGEX.test(container)) {
    clientSocket.end("-ERR Container inválido\r\n");
    return;
  }

  console.log(
    `[PROXY][Redis] Conectando ao container '${container}' com senha fornecida`
  );

  const redisSocket = net.connect(REDIS_TARGET_PORT, container);

  redisSocket.on("error", (e) => {
    console.log("[PROXY][Redis] erro:", e.message);
    try {
      clientSocket.end(`-ERR Falha ao conectar host ${container}\r\n`);
    } catch { }
  });

  redisSocket.on("connect", () => {
    console.log("[PROXY][Redis] conectado ao Redis real:", container);

    const authCmd = `*2\r\n$4\r\nAUTH\r\n$${password.length}\r\n${password}\r\n`;
    redisSocket.write(authCmd);

    redisSocket.write(firstChunk);
  });

  redisSocket.on("data", (d) => clientSocket.write(d));
  clientSocket.on("data", (d) => redisSocket.write(d));

  redisSocket.on("close", () => {
    try {
      clientSocket.end();
    } catch { }
  });
}

export default handleRedis;