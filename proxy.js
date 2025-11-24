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

    const bufFields = Buffer.from(fields);
    const bufLen = Buffer.alloc(4);
    bufLen.writeInt32BE(bufFields.length + 4);

    const finalBuf = Buffer.concat([
        Buffer.from("E"),
        bufLen,
        bufFields
    ]);

    client.write(finalBuf);
    client.end();
    console.log(`[PROXY] → Enviado ErrorResponse para cliente: ${message}`);
}

const server = net.createServer((client) => {
    console.log("[PROXY] Nova conexão de cliente");

    let buffer = Buffer.alloc(0);
    let sslHandled = false;
    let pgSocket = null;
    let targetHost = null;

    client.setNoDelay(true);

    client.on("data", (chunk) => {
        console.log("[PROXY] Cliente → proxy, bytes:", chunk.length, " conteúdo (hex):", chunk.toString("hex"));

        if (pgSocket) {
            // interceptando senha
            if (chunk[0] === 0x70) { // 'p'
                const len = chunk.readInt32BE(1);
                const pwd = chunk.toString("utf8", 5, len);
                console.log("[PROXY] 💬 PasswordMessage do cliente:", pwd);
            }

            pgSocket.write(chunk);
            return;
        }

        // buffer inicial
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length < 8) {
            console.log("[PROXY] buffer inicial menor que 8, aguardando mais dados...");
            return;
        }

        const length = buffer.readInt32BE(0);
        console.log("[PROXY] Mensagem inicial length:", length, "buffer.length:", buffer.length);

        if (buffer.length < length) {
            console.log("[PROXY] Ainda não recebeu a mensagem inteira, aguardando...");
            return;
        }

        const code = buffer.readInt32BE(4);
        console.log("[PROXY] Código lido no header:", code);

        // SSLRequest?
        if (!sslHandled && length === 8 && code === SSL_REQUEST_CODE) {
            console.log("[PROXY] Cliente solicitou SSL → respondendo 'N'");
            client.write("N");
            sslHandled = true;
            buffer = Buffer.alloc(0);
            return;
        }

        // StartupMessage?
        if (code !== PG_PROTOCOL_VERSION) {
            console.log("[PROXY] Código diferente de PG_PROTOCOL_VERSION, protocolo inválido:", code);
            sendPgError(client, "Protocolo inválido");
            return;
        }

        // Parsear StartupMessage
        let off = 8;
        let user = null;
        let db = null;
        while (off < length) {
            const keyEnd = buffer.indexOf(0, off);
            if (keyEnd === -1) break;
            const key = buffer.toString("utf8", off, keyEnd);
            off = keyEnd + 1;

            if (key === "") break;

            const valEnd = buffer.indexOf(0, off);
            if (valEnd === -1) break;
            const val = buffer.toString("utf8", off, valEnd);
            off = valEnd + 1;

            console.log(`[PROXY] Param StartupMessage → ${key} = ${val}`);

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
        console.log(`[PROXY] Vamos conectar no host Postgres destino: ${targetHost}:${TARGET_PORT} (db=${db})`);

        // Conectar no Postgres real
        pgSocket = net.connect(TARGET_PORT, targetHost);

        pgSocket.setNoDelay(true);

        pgSocket.on("connect", () => {
            console.log("[PROXY] Conectado ao Postgres real, enviando StartupMessage");
            pgSocket.write(buffer);
        });

        pgSocket.on("error", (err) => {
            console.log("[PROXY] Erro conexão com Postgres real:", err);
            sendPgError(client, `Host ${targetHost} não encontrado ou erro de conexão`);
        });

        pgSocket.on("data", (data) => {
            console.log("[PROXY] Postgres → proxy, bytes:", data.length, " conteúdo (hex):", data.toString("hex"));
            client.write(data);
        });

        pgSocket.on("end", () => {
            console.log("[PROXY] Conexão com Postgres real finalizada pelo servidor");
            client.end();
        });

        buffer = Buffer.alloc(0);
    });

    client.on("close", () => {
        console.log("[PROXY] Conexão cliente fechada");
        if (pgSocket) pgSocket.end();
    });

    client.on("error", (err) => {
        console.log("[PROXY] Erro no socket do cliente:", err);
        if (pgSocket) pgSocket.destroy();
    });
});

server.listen(PORT, () => {
    console.log(`[PROXY] 🚀 Proxy Postgres (verbose) escutando na porta ${PORT}`);
});
