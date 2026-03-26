'use strict';

const { createLogger, format, transports } = require('winston');
const path = require('path');

const logger = createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.errors({ stack: true }),
        format.json()
    ),
    transports: [
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.printf(({ timestamp, level, message, stack }) =>
                    stack
                        ? `${timestamp} [${level}]: ${message}\n${stack}`
                        : `${timestamp} [${level}]: ${message}`
                )
            ),
        }),
    ],
});

if (process.env.NODE_ENV === 'production') {
    logger.add(new transports.File({
        filename: path.join(__dirname, '../../logs/error.log'),
        level: 'error',
    }));
    logger.add(new transports.File({
        filename: path.join(__dirname, '../../logs/combined.log'),
    }));
}

module.exports = logger;
