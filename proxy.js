import net from "net";

const PORT = process.env.PROXY_PORT || 6432;
const TARGET_PORT = parseInt(process.env.TARGET_PORT || "5432", 10);

const DOCKER_HOST_REGEX = /^[a-z0-9]{12,40}$/;

// código fixo do SSLRequest (0x04D2162F)
const SSL_REQUEST_CODE = 80877103;

const server = net.createServer((clientSocket) => {
    let buffer = Buffer.alloc(0);

    clientSocket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        // Precisa ter ao menos 8 bytes
        if (buffer.length < 8) return;

        const length = buffer.readInt32BE(0);

        // Se ainda não chegou o pacote inteiro, espera
        if (buffer.length < length) return;

        const protocolVersion = buffer.readInt32BE(4);

        // ---------------- SSL REQUEST ----------------
        if (protocolVersion === SSL_REQUEST_CODE) {
            console.log("🔐 Cliente pediu SSL — recusando (N)");
            clientSocket.write("N"); // recusar SSL
            buffer = Buffer.alloc(0); // limpar buffer
            return;
        }

        // ---------------- STARTUP MESSAGE ----------------
        if (protocolVersion !== 0x00030000) {
            console.log("❌ Não é StartupMessage v3:", protocolVersion);
            clientSocket.destroy();
            return;
        }

        let offset = 8;
        let username = null;

        // Parse key/value parameters
        while (offset < length) {
            // acha fim da chave
            const keyEnd = buffer.indexOf(0, offset);
            if (keyEnd === -1) break;

            const key = buffer.toString("utf8", offset, keyEnd);
            offset = keyEnd + 1;

            if (key === "") {
                // terminador do StartupMessage
                break;
            }

            const valueEnd = buffer.indexOf(0, offset);
            if (valueEnd === -1) break;

            const value = buffer.toString("utf8", offset, valueEnd);
            offset = valueEnd + 1;

            if (key === "user") {
                username = value;
            }
        }

        if (!username) {
            console.log("❌ StartupMessage sem username.");
            clientSocket.destroy();
            return;
        }

        if (!DOCKER_HOST_REGEX.test(username)) {
            console.log(`❌ Username "${username}" não parece um hostname Docker.`);
            clientSocket.destroy();
            return;
        }

        console.log(`➡ Redirecionando para ${username}:${TARGET_PORT}`);

        const pgSocket = net.connect(TARGET_PORT, username);

        pgSocket.on("connect", () => {
            pgSocket.write(buffer); // reenviar StartupMessage original
        });

        pgSocket.on("error", (err) => {
            console.log(`❌ Erro ao conectar em ${username}:`, err.message);
            clientSocket.destroy();
        });

        pgSocket.pipe(clientSocket);
        clientSocket.pipe(pgSocket);

        // limpar para o próximo pacote
        buffer = Buffer.alloc(0);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Proxy Postgres ativo na porta ${PORT}`);
});            clientSocket.destroy();
            return;
        }

        let offset = 8;
        let username = null;

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

            if (key === "user") username = value;
        }

        if (!username) {
            console.log("❌ StartupMessage sem username.");
            clientSocket.destroy();
            return;
        }

        if (!DOCKER_HOST_REGEX.test(username)) {
            console.log(`❌ Username "${username}" inválido para docker.`);
            clientSocket.destroy();
            return;
        }

        console.log(`➡ Redirecionando para ${username}:${TARGET_PORT}`);

        const pgSocket = net.connect(TARGET_PORT, username);

        pgSocket.on("connect", () => {
            pgSocket.write(buffer); // Envia StartupMessage original
        });

        pgSocket.on("error", (err) => {
            console.log(`❌ Erro ao conectar em ${username}:`, err.message);
            clientSocket.destroy();
        });

        pgSocket.pipe(clientSocket);
        clientSocket.pipe(pgSocket);

        buffer = Buffer.alloc(0);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Proxy Postgres ativo na porta ${PORT}`);
});            if (keyEnd === -1) break;

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
