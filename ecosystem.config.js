module.exports = {
    apps: [
        {
            name: 'antigravity-web',
            script: 'main.js',
            cwd: '/home/tiemuer/antigravity-web',
            env: {
                PORT: 3210,
                NODE_ENV: 'production',
            },
            watch: false,
            max_memory_restart: '300M',
            error_file: './logs/pm2-error.log',
            out_file: './logs/pm2-out.log',
            merge_logs: true,
            time: true,
        },
        {
            name: 'cloudflared',
            script: 'cloudflared',
            args: 'tunnel run antigravity-web',
            interpreter: 'none',
            cwd: '/home/tiemuer/antigravity-web',
            watch: false,
            error_file: './logs/cloudflared-error.log',
            out_file: './logs/cloudflared-out.log',
            merge_logs: true,
            time: true,
        },
    ],
};
