import net from "net";

const PORT = process.env.PROXY_PORT || 6432;
const TARGET_PORT = parseInt(process.env.TARGET_PORT || "5432", 10);

const DOCKER_HOST_REGEX = /^[a-z0-9]{12,40}$/;
const PG_PROTOCOL_VERSION = 0x00030000;
const SSL_REQUEST_CODE = 80877103;

function sendPgError(client, message) {
    const fields =
        "SERROR\0" +
        "CXX000\0" +
        `M${message}\0` +
        "\0";

    const f = Buffer.from(fields);
    const len = Buffer.alloc(4);
    len.writeInt32BE(f.length + 4);

    const msg = Buffer.concat([
        Buffer.from("E"),
        len,
        f
    ]);

    client.write(msg);
    client.end();
}

const server = net.createServer((client) => {
    let buffer = Buffer.alloc(0);
    let sslHandled = false;
    let pgSocket = null;
    let targetHost = null;

    client.on("data", (chunk) => {
        // Se já conectado, apenas encaminhar
        if (pgSocket) {
            // Intercepta senha sem modificar nada
            if (chunk[0] === 0x70) {
                const len = chunk.readInt32BE(1);
                const pwd = chunk.toString("utf8", 5, len);
                console.log("🔑 Password:", pwd);
            }

            pgSocket.write(chunk);
            return;
        }

        // Build buffer até termos uma mensagem completa
        buffer = Buffer.concat([buffer, chunk]);

        if (buffer.length < 8) return;

        const length = buffer.readInt32BE(0);
        if (buffer.length < length) return;

        const code = buffer.readInt32BE(4);

        // ---- 1) SSLRequest ----
        if (!sslHandled && length === 8 && code === SSL_REQUEST_CODE) {
            client.write("N");
            sslHandled = true;
            buffer = Buffer.alloc(0);
            return;
        }

        // ---- 2) StartupMessage ----
        if (code !== PG_PROTOCOL_VERSION) {
            sendPgError(client, "Protocolo inválido");
            return;
        }

        // Parse StartupMessage
        let off = 8;
        let user = null;
        let db = null;

        while (off < length) {
            const kEnd = buffer.indexOf(0, off);
            if (kEnd === -1) break;
            const key = buffer.toString("utf8", off, kEnd);
            off = kEnd + 1;

            if (key === "") break;

            const vEnd = buffer.indexOf(0, off);
            if (vEnd === -1) break;
            const val = buffer.toString("utf8", off, vEnd);
            off = vEnd + 1;

            if (key === "user") user = val;
            if (key === "database") db = val;
        }

        if (!user) {
            sendPgError(client, "StartupMessage sem usuario");
            return;
        }

        if (!DOCKER_HOST_REGEX.test(user)) {
            sendPgError(client, `Host inválido: ${user}`);
            return;
        }

        targetHost = user;

        // ---- Conectar ao Postgres ----
        pgSocket = net.connect(TARGET_PORT, targetHost);

        pgSocket.on("connect", () => {
            // Envia o StartupMessage original SEM mexer
            pgSocket.write(buffer);
        });

        pgSocket.on("error", (err) => {
            console.log("Erro PG:", err.code);
            sendPgError(client, `Host ${targetHost} não encontrado`);
        });

        pgSocket.on("data", (data) => {
            client.write(data);
        });

        pgSocket.on("end", () => client.end());

        buffer = Buffer.alloc(0);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Proxy ativo na porta ${PORT}`);
});
