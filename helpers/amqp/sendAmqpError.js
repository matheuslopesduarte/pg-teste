import buildConnectionClose from "./buildConnectionClose.js";

function sendAmqpError(socket, code, message) {
  const payload = buildConnectionClose(code, message);

  const frameHeader = Buffer.alloc(7);
  frameHeader.writeUInt8(1, 0);       
  frameHeader.writeUInt16BE(0, 1);  
  frameHeader.writeUInt32BE(payload.length, 3);

  const frameEnd = Buffer.from([0xCE]);

  socket.write(Buffer.concat([frameHeader, payload, frameEnd]));

  setTimeout(() => socket.end(), 100);
}

export default sendAmqpError;