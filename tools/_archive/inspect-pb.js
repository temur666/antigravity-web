/**
 * inspect-pb.js — 检查 .pb 文件的原始格式
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const inputFile = path.join(__dirname, 'latest.pb');
const buf = fs.readFileSync(inputFile);

console.log(`文件大小: ${buf.length} bytes`);
console.log(`前 64 字节 hex:`);
console.log(buf.slice(0, 64).toString('hex'));
console.log('');
console.log(`前 64 字节 ascii:`);
console.log(buf.slice(0, 64).toString('ascii').replace(/[^\x20-\x7e]/g, '.'));
console.log('');

// 尝试检测格式
const magic = buf.slice(0, 4);
console.log(`Magic bytes: ${magic.toString('hex')} → "${magic.toString('ascii').replace(/[^\x20-\x7e]/g, '.')}"`);

// 检查是否是 gzip
if (buf[0] === 0x1f && buf[1] === 0x8b) {
    console.log('✅ 检测到 GZIP 格式');
    try {
        const decompressed = zlib.gunzipSync(buf);
        console.log(`解压后大小: ${decompressed.length} bytes`);
        console.log(`解压后前 200 字节:`);
        console.log(decompressed.slice(0, 200).toString('hex'));
        const str = decompressed.slice(0, 500).toString('utf-8').replace(/[^\x20-\x7e\n\r\t]/g, '.');
        console.log(`解压后前 500 字节 (文本):`, str);
        fs.writeFileSync(path.join(__dirname, 'latest-decompressed.bin'), decompressed);
        console.log('已保存解压文件: latest-decompressed.bin');
    } catch (e) {
        console.log('GZIP 解压失败:', e.message);
    }
}

// 检查是否是 zlib (deflate)
if (buf[0] === 0x78) {
    console.log('✅ 可能是 zlib/deflate 格式');
    try {
        const decompressed = zlib.inflateSync(buf);
        console.log(`解压后大小: ${decompressed.length} bytes`);
        const str = decompressed.slice(0, 500).toString('utf-8').replace(/[^\x20-\x7e\n\r\t]/g, '.');
        console.log(`解压后前 500 字节 (文本):`, str);
        fs.writeFileSync(path.join(__dirname, 'latest-decompressed.bin'), decompressed);
        console.log('已保存解压文件: latest-decompressed.bin');
    } catch (e) {
        console.log('zlib 解压失败:', e.message);
    }
}

// 尝试 brotli
try {
    const decompressed = zlib.brotliDecompressSync(buf);
    console.log(`✅ Brotli 解压成功! 大小: ${decompressed.length} bytes`);
    const str = decompressed.slice(0, 500).toString('utf-8').replace(/[^\x20-\x7e\n\r\t]/g, '.');
    console.log(`解压后前 500 字节:`, str);
    fs.writeFileSync(path.join(__dirname, 'latest-decompressed.bin'), decompressed);
} catch { }

// 尝试直接读取为 JSON
try {
    const str = buf.toString('utf-8');
    if (str.startsWith('{') || str.startsWith('[')) {
        console.log('✅ 看起来是 JSON');
        const parsed = JSON.parse(str);
        console.log('JSON keys:', Object.keys(parsed).slice(0, 20));
    }
} catch { }

// 尝试跳过前几个字节后解析 protobuf
console.log('\n尝试在不同偏移量处解析 protobuf:');
for (let offset = 0; offset <= 16; offset++) {
    try {
        const slice = buf.slice(offset);
        let pos = 0;
        const tag_byte = slice[pos];
        const fieldNumber = tag_byte >> 3;
        const wireType = tag_byte & 0x7;
        console.log(`  offset ${offset}: first tag byte=0x${tag_byte.toString(16)}, fn=${fieldNumber}, wt=${wireType}`);
    } catch { }
}

// 检查是否有 protobuf 里面的嵌套 AES-GCM 或类似加密
// 查看 entropy (高 entropy = 加密/压缩)
const byteFreq = new Array(256).fill(0);
for (let i = 0; i < Math.min(buf.length, 10000); i++) byteFreq[buf[i]]++;
let entropy = 0;
for (let i = 0; i < 256; i++) {
    if (byteFreq[i] > 0) {
        const p = byteFreq[i] / Math.min(buf.length, 10000);
        entropy -= p * Math.log2(p);
    }
}
console.log(`\n前 10KB 的 Shannon entropy: ${entropy.toFixed(4)} bits/byte`);
console.log(`(7.5+ = 加密/压缩, 4-6 = 普通二进制, <4 = 文本)`);
