function isPostgres(buf) {
  if (buf.length < 8) return false;

  const len = buf.readInt32BE(0);
  if (len < 8 || len > 50000) return false;

  return true;
}

export default isPostgres;