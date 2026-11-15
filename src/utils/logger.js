/**
 * Simple structured console logger for WaitLess Server.
 */
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = process.env.LOG_LEVEL || "info";
const currentLevelValue = LOG_LEVELS[currentLevel] ?? LOG_LEVELS.info;

const formatMessage = (level, message, meta) => {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    if (meta instanceof Error) {
      return `${base}\n${meta.stack || meta.message}`;
    }
    return `${base} ${JSON.stringify(meta)}`;
  }
  return base;
};

const logger = {
  error: (message, meta) => {
    if (currentLevelValue >= LOG_LEVELS.error) {
      console.error(formatMessage("error", message, meta));
    }
  },
  warn: (message, meta) => {
    if (currentLevelValue >= LOG_LEVELS.warn) {
      console.warn(formatMessage("warn", message, meta));
    }
  },
  info: (message, meta) => {
    if (currentLevelValue >= LOG_LEVELS.info) {
      console.log(formatMessage("info", message, meta));
    }
  },
  debug: (message, meta) => {
    if (currentLevelValue >= LOG_LEVELS.debug) {
      console.debug(formatMessage("debug", message, meta));
    }
  },
};

module.exports = logger;
