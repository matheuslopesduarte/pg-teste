import net from "net";

const PORT = process.env.PROXY_PORT || 6432;

// Regex que detecta hostnames internos Docker/Coolify
const DOCKER_HOST_REGEX = /^[a-z0-9]{12,40}$/;

const server = net.createServer((clientSocket) => {
    let buffer = Buffer.alloc(0);

    clientSocket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        // pacote inicial do Postgres
        if (buffer.length < 8) return;

        const length = buffer.readInt32BE(0);
        if (buffer.length < length) return;

        const payload = buffer.toString("utf8");

        const userMatch = payload.match(/user\x00([^\x00]+)/);

        if (!userMatch) {
            console.log("❌ Conexão sem username.");
            clientSocket.destroy();
            return;
        }

        const username = userMatch[1];

        // Verifica se o username é um hostname interno
        if (!DOCKER_HOST_REGEX.test(username)) {
            console.log(`❌ Username "${username}" não parece host Docker.`);
            clientSocket.destroy();
            return;
        }

        const targetHost = username;
        const targetPort = parseInt(process.env.TARGET_PORT || "5432");

        console.log(`➡ Redirecionando ${username} → ${targetHost}:${targetPort}`);

        const pgSocket = net.connect(targetPort, targetHost);

        pgSocket.on("connect", () => {
            pgSocket.write(buffer);
        });

        pgSocket.on("error", (err) => {
            console.log(`❌ Erro ao conectar em ${targetHost}:`, err.message);
            clientSocket.destroy();
        });

        pgSocket.pipe(clientSocket);
        clientSocket.pipe(pgSocket);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Proxy Postgres ativo na porta ${PORT}`);
});
