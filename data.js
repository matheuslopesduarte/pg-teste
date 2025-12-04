
export const HOST_REGEX = /^([a-zA-Z0-9][a-zA-Z0-9_.-]+)$/;
export const PORT = parseInt(process.env.PORT || "5432", 10);

export const PG_SSL_REQUEST_CODE = process.env.PG_SSL_REQUEST_CODE || 80877103;
export const PG_TARGET_PORT = parseInt(process.env.PG_TARGET_PORT || "5432", 10);
export const PG_TARGET_USERNAME = process.env.PG_TARGET_USERNAME || "postgres";
export const PG_PROTOCOL_VERSION = 0x00030000;

export const REDIS_TARGET_PORT = parseInt(process.env.REDIS_TARGET_PORT || "6379", 10);

export const AMQP_TARGET_PORT = parseInt(process.env.AMQP_TARGET_PORT || "5672", 10);
export const AMQP_TARGET_USERNAME = process.env.AMQP_TARGET_USERNAME || "appuser";
export const AMQP_LOCALE = process.env.AMQP_LOCALE || "en_US";