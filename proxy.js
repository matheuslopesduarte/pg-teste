import net from "net";

const PORT = parseInt(process.env.PROXY_PORT || "6432", 10);
const TARGET_PORT = parseInt(process.env.TARGET_PORT || "5432", 10);

const DOCKER_HOST_REGEX = /^[a-z0-9]{12,40}$/;
const PG_PROTOCOL_VERSION = 0x00030000;
const SSL_REQUEST_CODE = 80877103;

// Monta um StartupMessage seguro a partir de params (user, database, outros)
function buildStartupMessage(params) {
    const parts = [];
    for (const [k, v] of Object.entries(params)) {
        parts.push(Buffer.from(k + "\0", "utf8"));
        parts.push(Buffer.from(String(v) + "\0", "utf8"));
    }
    parts.push(Buffer.from("\0", "utf8")); // terminador final

    const body = Buffer.concat(parts);
    const header = Buffer.alloc(8);
    header.writeInt32BE(body.length + 8, 0); // length
    header.writeInt32BE(PG_PROTOCOL_VERSION, 4);

    return Buffer.concat([header, body]);
}

// Envia ErrorResponse no formato Postgres e finaliza o cliente
function sendPgError(client, message) {
    const fields =
        "SERROR\0" +           // severity
        "CXX000\0" +           // SQLSTATE (generic)
        `M${message}\0` +      // message
        "\0";                  // terminator
    const f = Buffer.from(fields, "utf8");
    const len = Buffer.alloc(4);
    len.writeInt32BE(f.length + 4);
    const out = Buffer.concat([Buffer.from("E"), len, f]);
    try { client.write(out); } catch (e) {}
    client.end();
}

// Tempo máximo (ms) para receber resposta inicial do Postgres real depois do StartupMessage
const HANDSHAKE_TIMEOUT_MS = 10_000;

const server = net.createServer((clientSocket) => {
    clientSocket.setNoDelay(true);

    let initialBuffer = Buffer.alloc(0);
    let sslHandled = false;
    let pgSocket = null;
    let targetHost = null;
    let handshakeTimer = null;

    function startHandshakeTimer() {
        clearTimeout(handshakeTimer);
        handshakeTimer = setTimeout(() => {
            console.log("[PROXY] Handshake timeout, fechando.");
            sendPgError(clientSocket, "Timeout ao negociar com servidor");
            if (pgSocket) pgSocket.destroy();
        }, HANDSHAKE_TIMEOUT_MS);
    }

    clientSocket.on("data", (chunk) => {
        // Se já temos pgSocket estabelecido, apenas passthrough (mas ainda intercepta password)
        if (pgSocket && pgSocket.writable) {
            // Intercepta PasswordMessage ('p' = 0x70)
            if (chunk.length > 0 && chunk[0] === 0x70) {
                try {
                    const len = chunk.readInt32BE(1);
                    const pwd = chunk.toString("utf8", 5, 4 + len - 4); // read bytes of password
                    console.log("[PROXY] 🔑 PasswordMessage do cliente:", pwd);
                } catch (e) {
                    console.log("[PROXY] Erro lendo PasswordMessage:", e.message);
                }
            }

            // Repassa tudo para o Postgres real
            if (!pgSocket.destroyed) pgSocket.write(chunk);
            return;
        }

        // Caso inicial: concatenar ao buffer até termos uma mensagem completa
        initialBuffer = Buffer.concat([initialBuffer, chunk]);

        // Primeiro: tratar SSLRequest (8 bytes)
        if (!sslHandled && initialBuffer.length >= 8) {
            const len = initialBuffer.readInt32BE(0);
            const code = initialBuffer.readInt32BE(4);
            if (len === 8 && code === SSL_REQUEST_CODE) {
                console.log("[PROXY] Cliente solicitou SSLRequest → respondendo 'N'");
                clientSocket.write("N");
                sslHandled = true;
                // remove os 8 bytes do buffer e continue (pode ter StartupMessage concatenado)
                initialBuffer = initialBuffer.slice(8);
            }
        }

        // Agora precisamos de ao menos 8 bytes para ler o header do StartupMessage
        if (initialBuffer.length < 8) return;

        const startupLen = initialBuffer.readInt32BE(0);
        if (initialBuffer.length < startupLen) {
            // Ainda esperando mais dados do StartupMessage
            return;
        }

        const protoOrVersion = initialBuffer.readInt32BE(4);
        if (protoOrVersion !== PG_PROTOCOL_VERSION) {
            sendPgError(clientSocket, "Protocolo inválido");
            return;
        }

        // Parse dos params do StartupMessage
        let off = 8;
        let clientUser = null;
        let clientDb = null;
        const otherParams = {};

        while (off < startupLen) {
            const keyEnd = initialBuffer.indexOf(0, off);
            if (keyEnd === -1) break;
            const key = initialBuffer.toString("utf8", off, keyEnd);
            off = keyEnd + 1;
            if (key === "") break; // terminador
            const valEnd = initialBuffer.indexOf(0, off);
            if (valEnd === -1) break;
            const val = initialBuffer.toString("utf8", off, valEnd);
            off = valEnd + 1;

            if (key === "user") clientUser = val;
            else if (key === "database") clientDb = val;
            else otherParams[key] = val;
        }

        if (!clientUser) {
            sendPgError(clientSocket, "StartupMessage sem usuario");
            return;
        }

        if (!DOCKER_HOST_REGEX.test(clientUser)) {
            sendPgError(clientSocket, `Hostname inválido: ${clientUser}`);
            return;
        }

        targetHost = clientUser;
        console.log(`[PROXY] StartupMessage parseado: user=${clientUser} db=${clientDb} params=${Object.keys(otherParams).join(",")}`);

        // Conectar no Postgres real (host = clientUser)
        pgSocket = net.connect(TARGET_PORT, targetHost);

        pgSocket.setNoDelay(true);

        pgSocket.on("connect", () => {
            console.log("[PROXY] Conectado ao Postgres real. Enviando StartupMessage reconstruído...");

            // Reconstruir StartupMessage para o Postgres destino:
            // user = 'postgres' (sempre), database = clientDb (sevier) e repassar outros params se quiser
            const startupParams = {
                user: "postgres",           // forçamos para postgres (conforme seu requisito)
                database: clientDb || "postgres",
                ...otherParams              // preserva outros parametros como application_name, client_encoding, ...
            };

            const startupBuf = buildStartupMessage(startupParams);
            pgSocket.write(startupBuf);

            // Se o cliente tinha enviado mais dados depois do StartupMessage inicial (resto do initialBuffer),
            // devemos repassar esse resto (por exemplo, se o cliente concatenou PasswordMessage no mesmo pacote).
            // initialBuffer pode conter bytes extras após startupLen
            const rest = initialBuffer.slice(startupLen);
            if (rest.length > 0) {
                console.log("[PROXY] Há bytes extras após StartupMessage, repassando para o Postgres real (length):", rest.length);
                pgSocket.write(rest);
            }

            // start handshake timeout
            startHandshakeTimer();
        });

        pgSocket.on("data", (data) => {
            // sempre limpar timeout pois recebemos algo do servidor
            clearTimeout(handshakeTimer);

            // repassar ao cliente
            try { clientSocket.write(data); } catch (e) {
                console.log("[PROXY] Erro escrevendo para cliente:", e.message);
            }
        });

        pgSocket.on("error", (err) => {
            console.log("[PROXY] Erro conexão com Postgres real:", err.code ?? err.message);
            sendPgError(clientSocket, `Host ${targetHost} não encontrado ou erro de conexão`);
        });

        pgSocket.on("end", () => {
            console.log("[PROXY] Postgres real encerrou a conexão");
            try { clientSocket.end(); } catch (e) {}
        });

        pgSocket.on("close", () => {
            clearTimeout(handshakeTimer);
        });

        // reset buffer (já repassamos o que precisava)
        initialBuffer = Buffer.alloc(0);
    });

    clientSocket.on("error", (err) => {
        console.log("[PROXY] Erro socket cliente:", err.message);
        if (pgSocket) pgSocket.destroy();
    });

    clientSocket.on("close", () => {
        clearTimeout(handshakeTimer);
        if (pgSocket) pgSocket.end();
    });
});

server.listen(PORT, () => {
    console.log(`[PROXY] 🚀 Proxy Postgres (reconstrói startup) escutando na porta ${PORT}`);
});
