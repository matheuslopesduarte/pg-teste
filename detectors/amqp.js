function isAMQP(buf) {
  if (buf.length < 8) return false;

  return (
    buf[0] === 0x41 && // A
    buf[1] === 0x4D && // M
    buf[2] === 0x51 && // Q
    buf[3] === 0x50 && // P
    buf[4] === 0x00 &&
    buf[5] === 0x00 &&
    buf[6] === 0x09 &&
    buf[7] === 0x01
  );
}

export default isAMQP;