const http2 = require('http2');
const fs = require('fs');

const PORT = 42200;
const LOG = '/tmp/h2-grpc.log';
fs.writeFileSync(LOG, '=== H2 gRPC Server Starting ===\n');

const server = http2.createServer();

server.on('stream', (stream, headers) => {
    const path = headers[':path'];
    const method = headers[':method'];
    fs.appendFileSync(LOG, `\n[REQUEST] ${method} ${path}\n`);

    let body = Buffer.alloc(0);
    stream.on('data', chunk => {
        body = Buffer.concat([body, chunk]);
    });
    
    stream.on('end', () => {
        // gRPC payload structure: [1 byte compress flag] [4 bytes length] [protobuf message]
        if (body.length >= 5) {
            const length = body.readUInt32BE(1);
            const pbData = body.slice(5);
            fs.appendFileSync(LOG, `[gRPC] Payload len: ${length}, PB Hex: ${pbData.toString('hex')}\n`);
            // Try to extract string fields heuristically
            const text = pbData.toString('utf8').replace(/[\x00-\x1F\x7F-\x9F]/g, '.');
            fs.appendFileSync(LOG, `[gRPC] Text trace: ${text}\n`);
        }

        // Return perfectly structured gRPC response
        // Using HTTP Status 200, but grpc-status 12 (UNIMPLEMENTED)
        // If we want to mock success, we would send grpc-status: 0
        if (path.includes('LanguageServerStarted') || path.includes('CheckTerminalShellSupport')) {
            stream.respond({
                'content-type': 'application/grpc',
                ':status': 200,
            });
            // Fake a dummy success empty proto (0 length)
            const reply = Buffer.alloc(5);
            reply.writeUInt8(0, 0); // Compress flag
            reply.writeUInt32BE(0, 1); // Length 0
            stream.write(reply);
            
            // Send trailers for grpc status
            stream.end(() => {
                stream.sendTrailers({ 'grpc-status': '0', 'grpc-message': 'OK' });
            });
            fs.appendFileSync(LOG, `[RESPONSE] Mocked Success (0)\n`);
        } else {
            stream.respond({
                'content-type': 'application/grpc',
                ':status': 200,
            });
            stream.end(() => {
                stream.sendTrailers({ 'grpc-status': '12', 'grpc-message': 'Unimplemented' });
            });
            fs.appendFileSync(LOG, `[RESPONSE] Unimplemented (12)\n`);
        }
    });

    stream.on('error', (e) => {
        fs.appendFileSync(LOG, `[STREAM ERROR] ${e.message}\n`);
    });
});

server.listen(PORT, '127.0.0.1', () => {
    fs.appendFileSync(LOG, `Listening on ${PORT}\n`);
});
