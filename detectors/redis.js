function isRedis(buf) {
  if (buf.length === 0) return false;

  const c = buf[0];

  return c === 0x2a || c === 0x24 || c === 0x2b || c === 0x2d || c === 0x3a;
}

export default isRedis;