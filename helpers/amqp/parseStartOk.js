function parseStartOk(payload) {
    let off = 0;

    const classId = payload.readUInt16BE(off); off += 2;
    const methodId = payload.readUInt16BE(off); off += 2;

    if (classId !== 10 || methodId !== 11) return null;

    const tableSize = payload.readUInt32BE(off);
    off += 4 + tableSize;

    const mechLen = payload.readUInt8(off); off += 1;
    const mechanism = payload.toString("utf8", off, off + mechLen);
    off += mechLen;

    const respSize = payload.readUInt32BE(off); off += 4;
    const response = payload.slice(off, off + respSize);
    off += respSize;

    // auth SASL/PLAIN = \x00user\x00pass
    const parts = response.toString().split("\x00");

    return {
        user: parts[1],
        pass: parts[2],
        mechanism
    };
}

export default parseStartOk;