// PM2 Ecosystem Configuration
// Docs: https://pm2.keymetrics.io/docs/usage/application-declaration/
module.exports = {
  apps: [
    {
      name: 'uebernahme-api',
      script: 'backend/src/server.js',
      cwd: __dirname,

      // Cluster mode — use all available CPU cores (max 2 for typical VPS)
      instances: 2,
      exec_mode: 'cluster',

      // Auto-restart on crash
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // Environment
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/pm2/err.log',
      out_file: 'logs/pm2/out.log',
      merge_logs: true,
    },
  ],
};
