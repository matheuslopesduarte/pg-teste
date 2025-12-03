function sendAMQPError(client, msg = "Proxy routing error") {
    const text = Buffer.from(msg, "utf8");
    const payload = Buffer.alloc(2 + 2 + 2 + 1 + text.length + 2 + 2);

    let p = 0;
    payload.writeUInt16BE(0x000A, p); p += 2; 
    payload.writeUInt16BE(0x0032, p); p += 2; 
    payload.writeUInt16BE(501, p); p += 2; 
    payload.writeUInt8(text.length, p); p += 1;
    text.copy(payload, p); p += text.length;
    payload.writeUInt16BE(0, p); p += 2;
    payload.writeUInt16BE(0, p);

    const frame = Buffer.alloc(1 + 2 + 4 + payload.length + 1);
    frame.writeUInt8(1, 0);
    frame.writeUInt16BE(0, 1);
    frame.writeUInt32BE(payload.length, 3);
    payload.copy(frame, 7);
    frame.writeUInt8(0xCE, frame.length - 1);

    client.write(frame);
    client.end();
}

export default sendAMQPError;