import encodeLongString from "./encodeLongString.js";
import { AMQP_LOCALE } from "../../data.js";

function buildConnectionStart() {
    const payload = [];

    const header = Buffer.alloc(4);
    header.writeUInt16BE(10, 0); 
    header.writeUInt16BE(10, 2); 
    payload.push(header);

    payload.push(Buffer.from([0, 9]));

    // server properties, vazio
    payload.push(Buffer.from([0, 0, 0, 0]));

    // auth mechanisms 
    payload.push(encodeLongString("PLAIN"));

    payload.push(encodeLongString(AMQP_LOCALE));

    return Buffer.concat(payload);
}

export default buildConnectionStart;