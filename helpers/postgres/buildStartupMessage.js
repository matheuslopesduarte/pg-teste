import { PG_PROTOCOL_VERSION } from "../../data.js";

function buildStartupMessage(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    parts.push(Buffer.from(k + "\0", "utf8"));
    parts.push(Buffer.from(String(v) + "\0", "utf8"));
  }
  parts.push(Buffer.from("\0", "utf8"));

  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeInt32BE(body.length + 8, 0);
  header.writeInt32BE(PG_PROTOCOL_VERSION, 4);

  return Buffer.concat([header, body]);
}

export default buildStartupMessage;