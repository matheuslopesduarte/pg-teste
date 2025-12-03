function parseRedisAuth(buf) {
  try {
    const str = buf.toString("utf8");
    if (!str.startsWith("*")) return null;
    if (!str.includes("AUTH")) return null;

    const parts = str.split("\r\n");
    const password = parts[4];
    return password;
  } catch {
    return null;
  }
}

export default parseRedisAuth;