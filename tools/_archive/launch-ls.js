/**
 * Antigravity Language Server --standalone 模式测试
 */

const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const LS_BINARY = path.join(
    process.env.LOCALAPPDATA,
    'Programs', 'Antigravity', 'resources', 'app',
    'extensions', 'antigravity', 'bin',
    'language_server_windows_x64.exe'
);

const csrfToken = crypto.randomUUID();

console.log('=== Language Server (--standalone) ===\n');
console.log(`CSRF Token: ${csrfToken}\n`);

const args = [
    '--standalone',
    '--enable_lsp',
    '--csrf_token', csrfToken,
    '--random_port',
    '--workspace_id', 'file_c_3A_Users_tiemuer_headless_workspace',
    '--cloud_code_endpoint', 'https://daily-cloudcode-pa.googleapis.com',
    '--app_data_dir', 'antigravity',
    '--persistent_mode',
    '--use_local_chrome',
];

console.log('Args:', args.join(' '), '\n');

const ls = spawn(LS_BINARY, args, { stdio: ['pipe', 'pipe', 'pipe'] });

ls.stdout.on('data', d => process.stdout.write(`[stdout] ${d}`));
ls.stderr.on('data', d => process.stderr.write(`[stderr] ${d}`));
ls.on('error', err => console.error('[error]', err.message));
ls.on('exit', (code) => { console.log(`\n[exit] code=${code}`); process.exit(code || 0); });

console.log(`PID: ${ls.pid}\nWaiting for ports...\n`);

let attempts = 0;
const check = setInterval(() => {
    attempts++;
    if (attempts > 30) {
        clearInterval(check);
        console.log('\nTimeout 30s. Final state:');
        try {
            const out = execSync(`netstat -ano | findstr "${ls.pid}"`, { encoding: 'utf-8', timeout: 3000 });
            console.log(out || '(no network activity)');
        } catch { console.log('(no network activity)'); }
        return;
    }
    try {
        const out = execSync(`netstat -ano | findstr "${ls.pid}" | findstr "LISTENING"`, { encoding: 'utf-8', timeout: 3000 }).trim();
        if (out) {
            clearInterval(check);
            console.log('\n=== Language Server is UP! ===\n');
            console.log('Listening ports:');
            out.split('\n').forEach(l => console.log(`  ${l.trim()}`));
            console.log(`\nCSRF Token: ${csrfToken}`);
            console.log('Press Ctrl+C to stop.');
        }
    } catch { process.stdout.write('.'); }
}, 1000);

process.on('SIGINT', () => { ls.kill(); process.exit(0); });
