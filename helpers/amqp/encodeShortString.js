function encodeShortString(str) {
    const buf = Buffer.from(str, "utf8");
    return Buffer.concat([Buffer.from([buf.length]), buf]);
}

export default encodeShortString;