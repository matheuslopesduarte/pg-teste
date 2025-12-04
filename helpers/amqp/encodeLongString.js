function encodeLongString(str) {
    const buf = Buffer.from(str, "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(buf.length, 0);
    return Buffer.concat([header, buf]);
}

export default encodeLongString;