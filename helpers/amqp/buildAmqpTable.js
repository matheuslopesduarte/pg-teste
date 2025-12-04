function buildAmqpTable(obj = {}) {
    const parts = [];

    for (const key in obj) {
        const keyBuf = Buffer.from(key, "utf8");

        const keyLen = Buffer.from([keyBuf.length]);

        const valueBuf = Buffer.from(obj[key], "utf8");

        const len = Buffer.alloc(4);
        len.writeUInt32BE(valueBuf.length)
        
        const entry = Buffer.concat([
            keyLen,
            keyBuf,
            Buffer.from("S"),
            len,
            valueBuf
        ]);

        parts.push(entry);
    }

    const table = Buffer.concat(parts);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(table.length);

    return Buffer.concat([size, table]);
}

export default buildAmqpTable;