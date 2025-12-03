import sendAmqpError from "../helpers/amqp/sendAmqpError.js";

function handleAMQP(clientSocket, firstChunk) {
  sendAmqpError(clientSocket);
}

export default handleAMQP;
