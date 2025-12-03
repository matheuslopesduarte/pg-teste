import processStartup from "../helpers/postgres/processStartup.js";
import { PG_SSL_REQUEST_CODE } from "../data.js";

function handlePostgres(clientSocket, firstChunk) {
  const initial = Buffer.from(firstChunk);

  if (initial.length >= 8) {
    const len = initial.readInt32BE(0);
    const code = initial.readInt32BE(4);

    if (len === 8 && code === PG_SSL_REQUEST_CODE) {
      console.log("[PROXY] SSLRequest - Sending N");

      clientSocket.write("N");

      return clientSocket.once("data", (startupChunk) =>
        processStartup(clientSocket, startupChunk)
      );
    }
  }

  processStartup(clientSocket, initial);
}

export default handlePostgres;
