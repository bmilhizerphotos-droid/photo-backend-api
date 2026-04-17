module.exports = {
  apps: [
    {
      name: 'photo-backend',
      script: 'server.js',
      cwd: 'C:\\Users\\bmilh\\photo-app\\photo-backend',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      error_file: 'C:\\Users\\bmilh\\photo-app\\photo-backend\\logs\\backend.err.log',
      out_file: 'C:\\Users\\bmilh\\photo-app\\photo-backend\\logs\\backend.out.log',
      time: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    },
    {
      name: 'photo-frontend',
      script: 'start-frontend.cjs',
      cwd: 'C:\\Users\\bmilh\\photo-app\\photo-backend',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      error_file: 'C:\\Users\\bmilh\\photo-app\\photo-backend\\logs\\frontend.err.log',
      out_file: 'C:\\Users\\bmilh\\photo-app\\photo-backend\\logs\\frontend.out.log',
      time: true,
      env: {
        NODE_ENV: 'development'
      }
    },
    {
      name: 'memory-enrichment',
      script: 'enrich-memories.js',
      cwd: 'C:\\Users\\bmilh\\photo-app\\photo-backend',
      interpreter: 'node',
      watch: false,
      autorestart: false,
      error_file: 'C:\\Users\\bmilh\\photo-app\\photo-backend\\logs\\memory-enrichment.err.log',
      out_file: 'C:\\Users\\bmilh\\photo-app\\photo-backend\\logs\\memory-enrichment.out.log',
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'vision-tagger',
      script: 'generate-vision-tags.js',
      cwd: 'C:\\Users\\bmilh\\photo-app\\photo-backend',
      interpreter: 'node',
      args: '--rpm 6 --concurrency 3',
      watch: false,
      autorestart: true,
      max_restarts: 50,
      min_uptime: '30s',
      restart_delay: 5000,
      error_file: 'C:\\Users\\bmilh\\.pm2\\logs\\vision-tagger-error.log',
      out_file: 'C:\\Users\\bmilh\\.pm2\\logs\\vision-tagger-out.log',
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'cloudflared',
      script: 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
      args: 'tunnel --config C:\\Users\\bmilh\\.cloudflared\\config.yml run photo-backend',
      interpreter: 'none',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      error_file: 'C:\\Users\\bmilh\\photo-app\\photo-backend\\logs\\cloudflared.err.log',
      out_file: 'C:\\Users\\bmilh\\photo-app\\photo-backend\\logs\\cloudflared.out.log',
      time: true
    }
  ]
};
