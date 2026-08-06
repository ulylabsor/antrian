// PM2 config untuk aplikasi antrian.
// Ekstensi .cjs karena package.json memakai type:module — PM2 memuat config sebagai CommonJS.
module.exports = {
  apps: [
    {
      name: 'antrian',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '300M',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3007,
      },
      out_file: './logs/out.log',
      error_file: './logs/err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
