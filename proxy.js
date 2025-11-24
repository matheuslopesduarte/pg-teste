import net from "net";

const PORT = process.env.PROXY_PORT || 6432;
const TARGET_PORT = parseInt(process.env.TARGET_PORT || "5432", 10);

const DOCKER_HOST_REGEX = /^[a-z0-9]{12,40}$/;

const PG_PROTOCOL_VERSION = 0x00030000;
const SSL_REQUEST_CODE = 80877103;

const server = net.createServer((clientSocket) => {
    let buffer = Buffer.alloc(0);
    let sslHandled = false;

    clientSocket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (buffer.length < 8) {
            return;
        }

        const length = buffer.readInt32BE(0);

        if (buffer.length < length) {
            return;
        }

        const code = buffer.readInt32BE(4);

        // 1️⃣ SSLRequest
        if (!sslHandled && length === 8 && code === SSL_REQUEST_CODE) {
            console.log("🔐 SSLRequest → respondendo 'N'");
            clientSocket.write("N");

            sslHandled = true;
            buffer = Buffer.alloc(0);

            return;
        }

        // 2️⃣ StartupMessage
        if (code !== PG_PROTOCOL_VERSION) {
            console.log("❌ Não é StartupMessage:", code);
            clientSocket.destroy();
            return;
        }

        // Parse params
        let offset = 8;
        let clientUser = null;
        let clientPassword = null;

        while (offset < length) {
            const keyEnd = buffer.indexOf(0, offset);
            if (keyEnd === -1) break;

            const key = buffer.toString("utf8", offset, keyEnd);
            offset = keyEnd + 1;

            if (key === "") break;

            const valEnd = buffer.indexOf(0, offset);
            if (valEnd === -1) break;

            const value = buffer.toString("utf8", offset, valEnd);
            offset = valEnd + 1;

            if (key === "user") clientUser = value;
            if (key === "password") clientPassword = value;
        }

        if (!clientUser) {
            console.log("❌ StartupMessage sem username");
            clientSocket.destroy();
            return;
        }

        if (!clientPassword) {
            console.log("❌ StartupMessage sem password");
            clientSocket.destroy();
            return;
        }

        if (!DOCKER_HOST_REGEX.test(clientUser)) {
            console.log(`❌ Username "${clientUser}" inválido para hostname Docker.`);
            clientSocket.destroy();
            return;
        }

        const targetHost = clientUser;
        console.log(`➡ Conectando ao container ${targetHost}:${TARGET_PORT}`);

        // Reescreve StartupMessage
        const params = [
            ["user", "postgres"],
            ["database", "postgres"],
            ["password", clientPassword]
        ];

        let newLength = 4 + 4;
        for (const [k, v] of params) {
            newLength += k.length + 1 + v.length + 1;
        }
        newLength += 1;

        const startup = Buffer.alloc(newLength);
        startup.writeInt32BE(newLength, 0);
        startup.writeInt32BE(PG_PROTOCOL_VERSION, 4);

        let w = 8;
        for (const [k, v] of params) {
            startup.write(k, w); w += k.length;
            startup[w++] = 0;
            startup.write(v, w); w += v.length;
            startup[w++] = 0;
        }
        startup[w] = 0;

        const pgSocket = net.connect(TARGET_PORT, targetHost);

        pgSocket.on("connect", () => {
            pgSocket.write(startup);
        });

        pgSocket.on("error", (err) => {
            console.log(`❌ Erro ao conectar em ${targetHost}:`, err.message);
            clientSocket.destroy();
        });

        pgSocket.pipe(clientSocket);
        clientSocket.pipe(pgSocket);

        buffer = Buffer.alloc(0);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Proxy Postgres ativo na porta ${PORT}`);
});ing("utf8", offset, valEnd);
            offset = valEnd + 1;

            if (key === "user") {
                username = value;
            }
        }

        if (!username) {
            console.log("❌ Pacote recebido sem username.");
            clientSocket.destroy();
            return;
        }

        if (!DOCKER_HOST_REGEX.test(username)) {
            console.log(`❌ Username "${username}" não bate com hostname Docker.`);
            clientSocket.destroy();
            return;
        }

        console.log(`➡ Redirecionando para ${username}:${TARGET_PORT}`);

        const pgSocket = net.connect(TARGET_PORT, username);

        pgSocket.on("connect", () => {
            // Envia o StartupMessage original
            pgSocket.write(buffer);
        });

        pgSocket.on("error", (err) => {
            console.log(`❌ Falha ao conectar em ${username}:`, err.message);
            clientSocket.destroy();
        });

        // PIPES
        pgSocket.pipe(clientSocket);
        clientSocket.pipe(pgSocket);

        // Limpa para não tentar processar novamente
        buffer = Buffer.alloc(0);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Proxy Postgres ativo na porta ${PORT}`);
});
