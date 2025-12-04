function writeAmqpFrame(socket, frameType, channel, payload) {
    const header = Buffer.alloc(7);
    header.writeUInt8(frameType, 0);
    header.writeUInt16BE(channel, 1);
    header.writeUInt32BE(payload.length, 3);
    const frameEnd = Buffer.from([0xCE]);
    socket.write(Buffer.concat([header, payload, frameEnd]));
}

export default writeAmqpFrame;