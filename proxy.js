import net from "net";

const PORT = process.env.PROXY_PORT || 6432;
const TARGET_PORT = parseInt(process.env.TARGET_PORT || "5432", 10);

// Regex para hostnames internos (opcional)
const DOCKER_HOST_REGEX = /^[a-z0-9]{12,40}$/;

const server = net.createServer((clientSocket) => {
    let buffer = Buffer.alloc(0);

    clientSocket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        // Precisa ao menos 8 bytes para o StartupMessage:
        // [int32 length][int32 protocol version]
        if (buffer.length < 8) return;

        const length = buffer.readInt32BE(0);

        // Espera o pacote completo
        if (buffer.length < length) return;

        // Agora temos um StartupMessage completo no buffer
        const protocolVersion = buffer.readInt32BE(4);
        if (protocolVersion !== 0x00030000) {
            console.log("❌ Não é StartupMessage Postgres v3:", protocolVersion);
            clientSocket.destroy();
            return;
        }

        let offset = 8;
        let username = null;

        while (offset < length) {
            const keyEnd = buffer.indexOf(0, offset);
            if (keyEnd === -1) break;

            const key = buffer.toString("utf8", offset, keyEnd);
            offset = keyEnd + 1;

            if (key === "") break; // terminador

            const valEnd = buffer.indexOf(0, offset);
            if (valEnd === -1) break;

            const value = buffer.toString("utf8", offset, valEnd);
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