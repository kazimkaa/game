// utils/logger.js
class Logger {
    constructor(prefix = 'SERVER') {
        this.prefix = prefix;
    }

    log(message, ...args) {
        console.log(`[${this.prefix}] 📝 ${message}`, ...args);
    }

    info(message, ...args) {
        console.log(`[${this.prefix}] ℹ️ ${message}`, ...args);
    }

    warn(message, ...args) {
        console.warn(`[${this.prefix}] ⚠️ ${message}`, ...args);
    }

    error(message, ...args) {
        console.error(`[${this.prefix}] ❌ ${message}`, ...args);
    }

    debug(message, ...args) {
        if (process.env.DEBUG === 'true') {
            console.log(`[${this.prefix}] 🔍 ${message}`, ...args);
        }
    }

    game(message, ...args) {
        console.log(`[${this.prefix}] 🎮 ${message}`, ...args);
    }

    network(message, ...args) {
        console.log(`[${this.prefix}] 🌐 ${message}`, ...args);
    }
}

module.exports = Logger;
