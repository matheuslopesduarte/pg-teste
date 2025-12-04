import encodeShortString from "./encodeShortString.js";

function buildConnectionClose(replyCode, replyText) {
    const parts = [];

    const header = Buffer.alloc(4);
    header.writeUInt16BE(10, 0);
    header.writeUInt16BE(50, 2);
    parts.push(header);

    const codeBuf = Buffer.alloc(2);
    codeBuf.writeUInt16BE(replyCode, 0);
    parts.push(codeBuf);

    parts.push(encodeShortString(replyText));

    const zeros = Buffer.alloc(4);
    parts.push(zeros);

    return Buffer.concat(parts);
}

export default buildConnectionClose;