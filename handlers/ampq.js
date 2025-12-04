import sendAmqpError from "../helpers/amqp/sendAmqpError.js";
import { HOST_REGEX, AMQP_TARGET_USERNAME, AMQP_TARGET_PORT } from "../data.js";
import buildConnectionStart from "../helpers/amqp/buildConnectionStart.js";
import parseStartOk from "../helpers/amqp/parseStartOk.js";
import buildRealStartOk from "../helpers/amqp/buildRealStartOk.js";
import writeAmqpFrame from "../helpers/amqp/writeAmqpFrame.js";
import net from "net";

function handleAMQP(clientSocket, firstChunk) {
  console.log("[PROXY][AMQP] Detected AMQP handshake");

  const expected = Buffer.from("AMQP\0\0\x09\x01", "binary");
  if (!firstChunk.slice(0, 8).equals(expected)) {
    sendAmqpError(clientSocket, 500, "ERR invalid AMQP header");
    return;
  }

  const startPayload = buildConnectionStart();
  writeAmqpFrame(clientSocket, 1, 0, startPayload);

  clientSocket.once("data", (data) => {
    const frameType = data.readUInt8(0);
    const channel = data.readUInt16BE(1);
    const size = data.readUInt32BE(3);
    const payload = data.slice(7, 7 + size);

    if (frameType !== 1 || channel !== 0) {
      return sendAmqpError(clientSocket, 502, "ERR Expected Start-Ok");
    }

    const auth = parseStartOk(payload);
    if (!auth) {
      return sendAmqpError(clientSocket, 503, "ERR Invalid Start-Ok");
    }

    const userHost = auth.user;
    const password = auth.pass;

    if (!HOST_REGEX.test(userHost)) {
      return sendAmqpError(
        clientSocket,
        504,
        `ERR Container inválido: ${userHost}`
      );
    }

    console.log(
      `[PROXY][AMQP] Connecting to backend at ${userHost}:${AMQP_TARGET_PORT}`
    );

    const backend = net.connect(AMQP_TARGET_PORT, userHost);
    backend.on("error", (err) => {
      console.log("[PROXY][AMQP] Backend error:", err.message);
      sendAmqpError(clientSocket, 505, "ERR backend connection failed");
    });

    backend.once("connect", () => {
      backend.write(Buffer.from("AMQP\0\0\x09\x01", "binary"));

      backend.once("data", (startFrame) => {

        console.log("startFrame", startFrame.toString("hex"));

        const payload = buildRealStartOk(AMQP_TARGET_USERNAME, password);
        writeAmqpFrame(backend, 1, 0, payload);

        backend.pipe(clientSocket);
        clientSocket.pipe(backend);

        console.log("[PROXY][AMQP] Handshake complete, streaming frames...");
      });
    });

    backend.on("close", () => clientSocket.end());
  });
}

export default handleAMQP;
