function sendPgError(client, message) {
  const fields = "SERROR\0" + "CXX000\0" + `M${message}\0` + "\0";
  const f = Buffer.from(fields, "utf8");
  const len = Buffer.alloc(4);
  len.writeInt32BE(f.length + 4);
  const out = Buffer.concat([Buffer.from("E"), len, f]);
  try {
    client.write(out);
  } catch {}
  client.end();
}

export default sendPgError;