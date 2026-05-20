/**
 * PM2 ecosystem manifest for hao-backprop-test.
 *
 * Usage:
 *   pm2 start ecosystem.config.js                  # default `env` block (development)
 *   pm2 start ecosystem.config.js --env production # `env_production` block (cluster mode)
 *   pm2 reload ecosystem.config.js --env production
 *   pm2 stop ecosystem.config.js
 *
 * Note on cwd: PM2 may launch the process from a working directory that differs
 * from this file's location. Setting `cwd: __dirname` ensures `dotenv` reliably
 * loads `.env` regardless of where `pm2 start` is invoked from.
 */

module.exports = {
  apps: [
    {
      name: 'hao-backprop-test',
      script: './server.js',
      cwd: __dirname,
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      max_restarts: 10,
      min_uptime: '5s',
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        HOST: '127.0.0.1',
        LOG_LEVEL: 'debug'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '127.0.0.1',
        LOG_LEVEL: 'info'
      }
    }
  ]
};
