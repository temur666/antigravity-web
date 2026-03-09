const http = require('http');
const fs = require('fs');
const LOG = '/tmp/ext-perfect.log';

const server = http.createServer((req, res) => {
    let body = Buffer.alloc(0);
    req.on('data', chunk => body = Buffer.concat([body, chunk]));
    req.on('end', () => {
        const path = req.url || '';
        
        if (path.includes('CheckTerminalShellSupport')) {
            res.writeHead(200, { 'Content-Type': 'application/proto' });
            res.end(Buffer.from([0x08, 0x01]));
            return;
        }

        if (path.includes('Subscribe')) {
            res.writeHead(200, { 
                'Content-Type': 'application/connect+proto',
                'Connect-Protocol-Version': '1'
            });
            return;
        }

        // 所有的 Unary
        res.writeHead(200, { 'Content-Type': 'application/proto' });
        res.end(Buffer.alloc(0));
    });
});
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.listen(42200, '127.0.0.1');
