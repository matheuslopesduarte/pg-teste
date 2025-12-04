import buildAmqpTable from "./buildAmqpTable.js";
import encodeLongString from "./encodeLongString.js"; 
import encodeShortString from "./encodeShortString.js";

function buildRealStartOk(user, pass) {
    const method = Buffer.alloc(4);
    method.writeUInt16BE(10, 0); 
    method.writeUInt16BE(11, 2); 

    const clientProps = buildAmqpTable({
        product: "proxy-amqp",
        version: "1.0",
        platform: "nodejs",
    });

    const mechanism = encodeShortString("PLAIN");
    const response = encodeLongString(`\0${user}\0${pass}`);
    const locale = encodeShortString("en_US");
    return Buffer.concat([
        method,
        clientProps,
        mechanism,
        response,
        locale
    ]);
}
export default buildRealStartOk;