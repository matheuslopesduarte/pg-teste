import { HOST_REGEX, PG_TARGET_PORT, PG_TARGET_USERNAME } from "../../data.js";
import { PG_PROTOCOL_VERSION } from "../../data.js";
import sendPgError from "./sendPgError.js";
import buildStartupMessage from "./buildStartupMessage.js";
import net from "net";

function processStartup(clientSocket, buf) {
  if (buf.length < 8) {
    return sendPgError(clientSocket, "ERRStartupMessage inválida");
  }

  const startupLen = buf.readInt32BE(0);
  const proto = buf.readInt32BE(4);

  if (proto !== PG_PROTOCOL_VERSION) {
    return sendPgError(clientSocket, "ERR Protocolo inválido");
  }

  let off = 8;
  let clientUser = null;
  let clientDb = null;
  const otherParams = {};

  while (off < startupLen) {
    const kEnd = buf.indexOf(0, off);
    if (kEnd === -1) break;
    const key = buf.toString("utf8", off, kEnd);
    off = kEnd + 1;
    if (!key) break;

    const vEnd = buf.indexOf(0, off);
    if (vEnd === -1) break;
    const value = buf.toString("utf8", off, vEnd);
    off = vEnd + 1;

    if (key === "user") clientUser = value;
    else if (key === "database") clientDb = value;
    else otherParams[key] = value;
  }

  if (!clientUser) {
    return sendPgError(clientSocket, "ERR StartupMessage sem user");
  }

  if (!HOST_REGEX.test(clientUser)) {
    return sendPgError(clientSocket, `ERR Container inválido: ${clientUser}`);
  }

  const targetHost = clientUser;
  console.log(`[PROXY] PG Startup → target host=${targetHost} db=${clientDb}`);

  const pgSocket = net.connect(PG_TARGET_PORT, targetHost, () => {
    console.log("[PROXY] Conectado ao Postgres real");

    const params = {
      user: PG_TARGET_USERNAME,
      database: clientDb || "postgres",
      ...otherParams,
    };

    const startupBuf = buildStartupMessage(params);

    pgSocket.write(startupBuf);

    const leftover = buf.slice(startupLen);
    if (leftover.length > 0) pgSocket.write(leftover);
  });

  pgSocket.on("data", (data) => {
    clientSocket.write(data);
  });

  clientSocket.on("data", (chunk) => {
    pgSocket.write(chunk);
  });

  pgSocket.on("error", (err) => {
    console.log("[PROXY] PG erro:", err.message);
    sendPgError(clientSocket, `ERR Erro ao conectar ao host ${targetHost}`);
  });

  clientSocket.on("close", () => pgSocket.destroy());
  pgSocket.on("close", () => clientSocket.destroy());
};

export default processStartup;