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

        const auth = parseStartOk(payload);

        if (!auth) {
            sendAmqpError(clientSocket, 502, "ERR invalid Start-Ok");
            return;
        }

        if (!HOST_REGEX.test(auth.user)) {
            sendAmqpError(clientSocket, 503, `ERR Container inválido: ${auth.user}`);
            return;
        }

        const containerHost = auth.user;
        const password = auth.pass;
        const realUser = AMQP_TARGET_USERNAME;

        console.log(`[PROXY][AMQP] Connecting to RabbitMQ at ${containerHost}:${AMQP_TARGET_PORT}`);

        const backend = net.connect(AMQP_TARGET_PORT, containerHost);

        backend.on("error", (err) => {
            console.log("[PROXY][AMQP] Backend error:", err.message);
            sendAmqpError(clientSocket, 501, "ERR Falha ao conectar host " + containerHost);
        });

        backend.on("connect", () => {
            console.log("[PROXY][AMQP] Connected to real RabbitMQ backend");

            backend.write(Buffer.from("AMQP\0\0\x09\x01", "binary"));

            const realStartOk = buildRealStartOk(realUser, password);
            writeAmqpFrame(backend, 1, 0, realStartOk);

            backend.pipe(clientSocket);
            clientSocket.pipe(backend);
        });

        backend.on("close", () => {
            clientSocket.end();
        });
    });
}

export default handleAMQP;
