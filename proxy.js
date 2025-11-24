import net from "net";

const PORT = process.env.PROXY_PORT || 6432;
const TARGET_PORT = parseInt(process.env.TARGET_PORT || "5432", 10);

const DOCKER_HOST_REGEX = /^[a-z0-9]{12,40}$/;
const PG_PROTOCOL_VERSION = 0x00030000;
const SSL_REQUEST_CODE = 80877103;

// ---- Função: envia erro Postgres para o cliente ----
function sendPostgresError(client, message) {
    const fields =
        "SERROR\0" +      // Severity
        "CXX000\0" +      // SQLSTATE genérico
        `M${message}\0` + // Mensagem
        "\0";             // Terminador final

    const bufFields = Buffer.from(fields);
    const bufLen = Buffer.alloc(4);
    bufLen.writeInt32BE(bufFields.length + 4);

    const finalBuf = Buffer.concat([
        Buffer.from("E"), // Tipo ErrorResponse
        bufLen,
        bufFields
    ]);

    client.write(finalBuf);
    client.end();
}

// ----------------------------------------------------

const server = net.createServer((clientSocket) => {
    let buffer = Buffer.alloc(0);
    let sslHandled = false;

    let clientUser = null;
    let clientDb = null;
    let targetHost = null;
    let pgSocket = null;

    clientSocket.on("data", (chunk) => {
        // Se ainda não conectamos ao PG real, tratamos SSL + StartupMessage
        if (!pgSocket) {
            buffer = Buffer.concat([buffer, chunk]);

            if (buffer.length < 8) return;

            const length = buffer.readInt32BE(0);
            if (buffer.length < length) return;

            const code = buffer.readInt32BE(4);

            // ---- 1) Trata SSLRequest ----
            if (!sslHandled && length === 8 && code === SSL_REQUEST_CODE) {
                clientSocket.write("N");
                sslHandled = true;
                buffer = Buffer.alloc(0);
                return;
            }

            // ---- 2) StartupMessage ----
            if (code !== PG_PROTOCOL_VERSION) {
                sendPostgresError(clientSocket, "Protocolo inválido");
                return;
            }

            // Parse de parâmetros
            let off = 8;
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

                if (key === "user") clientUser = val;
                if (key === "database") clientDb = val;
            }

            if (!clientUser) {
                sendPostgresError(clientSocket, "StartupMessage sem username");
                return;
            }

            if (!DOCKER_HOST_REGEX.test(clientUser)) {
                sendPostgresError(clientSocket, `Hostname inválido: ${clientUser}`);
                return;
            }

            targetHost = clientUser;

            // ---- Conectar ao Postgres REAL ----
            pgSocket = net.connect(TARGET_PORT, targetHost, () => {
                // Envia StartupMessage original
                pgSocket.write(buffer);
            });

            // ---- Erro ao conectar ao destino ----
            pgSocket.on("error", (err) => {
                console.log(`❌ Falha ao conectar em ${targetHost}:`, err.code);
                sendPostgresError(clientSocket, `Database ${targetHost} não encontrado`);
            });

            // ---- Dados vindo do Postgres real ----
            pgSocket.on("data", (postgresData) => {
                clientSocket.write(postgresData);
            });

            // ---- Agora capturamos a senha ----
            clientSocket.on("data", (chunk2) => {
                // 'p' = PasswordMessage
                if (chunk2[0] === 0x70) {
                    const len = chunk2.readInt32BE(1);
                    const password = chunk2.toString("utf8", 5, len);

                    console.log(`🔑 Senha capturada: ${password}`);
                }

                // Passa tudo para o Postgres real
                if (pgSocket) pgSocket.write(chunk2);
            });

            buffer = Buffer.alloc(0);
            return;
        }

        // Se já existe pgSocket → é fluxo normal (passthrough)
        pgSocket.write(chunk);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Proxy Postgres ativo na porta ${PORT}`);
});
