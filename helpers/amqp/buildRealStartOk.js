import { AMQP_LOCALE } from "../../data.js";
 
function buildRealStartOk(user, pass) {
    const parts = [];

    const header = Buffer.alloc(4);
    header.writeUInt16BE(10);
    header.writeUInt16BE(11);
    parts.push(header);

    parts.push(Buffer.from([0, 0, 0, 0]));

    parts.push(Buffer.from([5, ...Buffer.from("PLAIN")]));

    const sasl = Buffer.from(`\0${user}\0${pass}`);
    const respLen = Buffer.alloc(4);
    respLen.writeUInt32BE(sasl.length);
    parts.push(respLen);
    parts.push(sasl);

    parts.push(Buffer.from([5, ...Buffer.from(AMQP_LOCALE)]));

    return Buffer.concat(parts);
}

export default buildRealStartOk;