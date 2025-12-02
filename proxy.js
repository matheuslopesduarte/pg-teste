import net from "net";

/**
 * CONFIGS
 */
const PORT = parseInt(process.env.PROXY_PORT || "6432", 10);
const PG_TARGET_PORT = parseInt(process.env.TARGET_PORT || "5432", 10);
const REDIS_TARGET_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);

const DOCKER_HOST_REGEX = /^[a-z0-9]{12,40}$/;
const PG_PROTOCOL_VERSION = 0x00030000;
const SSL_REQUEST_CODE = 80877103;
const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * HELPERS
 */

function isRedis(buf) {
    if (buf.length === 0) return false;

    const c = buf[0];
    // RESP: *, $, +, -, :
    return (
        c === 0x2A || c === 0x24 || c === 0x2B || c === 0x2D || c === 0x3A
    );
}

function isPostgres(buf) {
    if (buf.length < 8) return false;

    const len = buf.readInt32BE(0);
    if (len < 8 || len > 50000) return false;

    return true;
}

function parseRedisAuth(buf) {
    try {
        const str = buf.toString("utf8");
        if (!str.startsWith("*")) return null;
        if (!str.includes("AUTH")) return null;

        // "*2\r\n$4\r\nAUTH\r\n$XX\r\npassword\r\n"
        const parts = str.split("\r\n");
        const password = parts[4];
        return password;
    } catch {
        return null;
    }
}

/**
 * Postgres: build StartupMessage
 */
function buildStartupMessage(params) {
    const parts = [];
    for (const [k, v] of Object.entries(params)) {
        parts.push(Buffer.from(k + "\0", "utf8"));
        parts.push(Buffer.from(String(v) + "\0", "utf8"));
    }
    parts.push(Buffer.from("\0", "utf8")); // terminador

    const body = Buffer.concat(parts);
    const header = Buffer.alloc(8);
    header.writeInt32BE(body.length + 8, 0);
    header.writeInt32BE(PG_PROTOCOL_VERSION, 4);

    return Buffer.concat([header, body]);
}

function sendPgError(client, message) {
    const fields =
        "SERROR\0" +
        "CXX000\0" +
        `M${message}\0` +
        "\0";
    const f = Buffer.from(fields, "utf8");
    const len = Buffer.alloc(4);
    len.writeInt32BE(f.length + 4);
    const out = Buffer.concat([Buffer.from("E"), len, f]);
    try {
        client.write(out);
    } catch {}
    client.end();
}

/**
 * HANDLER REDIS
 */
function handleRedis(clientSocket, firstChunk) {
    console.log("[PROXY] Redis DETECTED");

    const passRaw = parseRedisAuth(firstChunk);
    if (!passRaw) {
        clientSocket.end("-ERR Formato AUTH inválido. Use AUTH container:senha\r\n");
        return;
    }

    const [container, password] = passRaw.split(":");

    if (!container || !password) {
        clientSocket.end("-ERR Formato: AUTH container:senha\r\n");
        return;
    }

    if (!DOCKER_HOST_REGEX.test(container)) {
        clientSocket.end("-ERR Container inválido\r\n");
        return;
    }

    console.log(
        `[PROXY][Redis] Conectando ao container '${container}' com senha fornecida`
    );

    const redisSocket = net.connect(REDIS_TARGET_PORT, container);

    redisSocket.on("connect", () => {
        console.log("[PROXY][Redis] conectado ao Redis real:", container);

        // Enviar AUTH real
        const authCmd = `*2\r\n$4\r\nAUTH\r\n$${password.length}\r\n${password}\r\n`;
        redisSocket.write(authCmd);

        // Repassar o primeiro chunk (o AUTH original do cliente)
        redisSocket.write(firstChunk);
    });

    redisSocket.on("data", (d) => clientSocket.write(d));
    clientSocket.on("data", (d) => redisSocket.write(d));

    redisSocket.on("error", (e) => {
        console.log("[PROXY][Redis] erro:", e.message);
        try {
            clientSocket.end("-ERR Falha ao conectar no Redis backend\r\n");
        } catch {}
    });

    redisSocket.on("close", () => {
        try {
            clientSocket.end();
        } catch {}
    });
}

/**
 * HANDLER POSTGRES
 */
function handlePostgres(clientSocket, firstChunk) {
    console.log("[PROXY] Postgres DETECTED");

    let initialBuffer = Buffer.from(firstChunk);
    let sslHandled = false;
    let pgSocket = null;
    let targetHost = null;
    let handshakeTimer = null;

    function startHandshakeTimer() {
        clearTimeout(handshakeTimer);
        handshakeTimer = setTimeout(() => {
            console.log("[PROXY] Handshake timeout");
            sendPgError(clientSocket, "Timeout ao negociar com servidor");
            if (pgSocket) pgSocket.destroy();
        }, HANDSHAKE_TIMEOUT_MS);
    }

    clientSocket.on("data", (chunk) => {
        // Pass-through caso já esteja conectado
        if (pgSocket && pgSocket.writable) {
            if (chunk.length > 0 && chunk[0] === 0x70) {
                try {
                    const len = chunk.readInt32BE(1);
                    const pwd = chunk.toString("utf8", 5, 4 + len - 4);
                    console.log("[PROXY] 🔑 PasswordMessage:", pwd);
                } catch {}
            }

            return pgSocket.write(chunk);
        }

        // Caso inicial
        initialBuffer = Buffer.concat([initialBuffer, chunk]);

        // SSLRequest
        if (!sslHandled && initialBuffer.length >= 8) {
            const len = initialBuffer.readInt32BE(0);
            const code = initialBuffer.readInt32BE(4);
            if (len === 8 && code === SSL_REQUEST_CODE) {
                console.log("[PROXY] SSLRequest → N");
                clientSocket.write("N");
                sslHandled = true;
                initialBuffer = initialBuffer.slice(8);
            }
        }

        if (initialBuffer.length < 8) return;

        const startupLen = initialBuffer.readInt32BE(0);
        if (initialBuffer.length < startupLen) return;

        const proto = initialBuffer.readInt32BE(4);
        if (proto !== PG_PROTOCOL_VERSION) {
            sendPgError(clientSocket, "Protocolo inválido");
            return;
        }

        let off = 8;
        let clientUser = null;
        let clientDb = null;
        const otherParams = {};

        while (off < startupLen) {
            const kEnd = initialBuffer.indexOf(0, off);
            if (kEnd === -1) break;
            const key = initialBuffer.toString("utf8", off, kEnd);
            off = kEnd + 1;
            if (key === "") break;

            const vEnd = initialBuffer.indexOf(0, off);
            if (vEnd === -1) break;
            const val = initialBuffer.toString("utf8", off, vEnd);
            off = vEnd + 1;

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

        console.log(
            `[PROXY] PG Startup: user=${clientUser}, db=${clientDb}`
        );

        pgSocket = net.connect(PG_TARGET_PORT, targetHost);

        pgSocket.on("connect", () => {
            console.log("[PROXY] Conectado ao Postgres real");

            const params = {
                user: "postgres",
                database: clientDb || "postgres",
                ...otherParams,
            };

            const startupBuf = buildStartupMessage(params);
            pgSocket.write(startupBuf);

            const rest = initialBuffer.slice(startupLen);
            if (rest.length > 0) pgSocket.write(rest);

            startHandshakeTimer();
        });

        pgSocket.on("data", (data) => {
            clearTimeout(handshakeTimer);
            clientSocket.write(data);
        });

        pgSocket.on("error", (err) => {
            console.log("[PROXY] Erro PG:", err.message);
            sendPgError(clientSocket, `Erro conectando ao host ${targetHost}`);
        });

        pgSocket.on("close", () => clearTimeout(handshakeTimer));

        initialBuffer = Buffer.alloc(0);
    });
}

/**
 * SERVER
 */
const server = net.createServer((clientSocket) => {
    clientSocket.setNoDelay(true);

    // Detecta o primeiro pacote
    clientSocket.once("data", (firstChunk) => {
        if (isPostgres(firstChunk)) {
            return handlePostgres(clientSocket, firstChunk);
        }
        if (isRedis(firstChunk)) {
            return handleRedis(clientSocket, firstChunk);
        }

        clientSocket.end("ERR: Protocolo desconhecido\n");
    });
});

server.listen(PORT, () => {
    console.log(`[PROXY] Proxy Multi (PG + Redis) escutando em ${PORT}`);
});
