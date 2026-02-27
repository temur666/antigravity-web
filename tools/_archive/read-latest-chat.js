/**
 * read-latest-chat.js — 通过 CDP 读取当前打开的 Chat 面板的全部对话内容
 * 
 * Usage: node tools/read-latest-chat.js
 * Output: tools/latest-chat-content.txt
 */
const { httpGet, cdpSend, cdpEval, sleep } = require('../lib/cdp');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, 'latest-chat-content.txt');

async function main() {
    const lines = [];
    const log = (...args) => {
        const line = args.join(' ');
        console.log(line);
        lines.push(line);
    };

    log('═'.repeat(80));
    log('通过 CDP 读取 Chat 面板对话内容');
    log(`时间: ${new Date().toISOString()}`);
    log('═'.repeat(80));
    log('');

    // 1. 获取 Target 列表
    let targets;
    try {
        targets = await httpGet('http://127.0.0.1:9000/json');
    } catch (e) {
        log(`❌ CDP 未连接: ${e.message}`);
        fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
        return;
    }

    // 2. 找到所有工作区页面
    const workspaces = targets.filter(t =>
        t.type === 'page' &&
        t.url && t.url.includes('workbench.html') &&
        !t.url.includes('workbench-jetski-agent')
    );

    log(`找到 ${workspaces.length} 个工作区:`);
    workspaces.forEach((w, i) => log(`  [${i}] ${w.title}`));
    log('');

    if (workspaces.length === 0) {
        log('❌ 没有找到任何打开的工作区');
        fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
        return;
    }

    // 逐个工作区尝试读取
    for (let wi = 0; wi < workspaces.length; wi++) {
        const target = workspaces[wi];
        log(`━━━ 尝试工作区 [${wi}]: ${target.title} ━━━`);

        let ws;
        try {
            ws = new WebSocket(target.webSocketDebuggerUrl);
            await new Promise((resolve, reject) => {
                ws.on('open', resolve);
                ws.on('error', reject);
                setTimeout(() => reject(new Error('connect timeout')), 5000);
            });

            await cdpSend(ws, 'Runtime.enable');
            log('✅ 已连接');

            // 3. 先探测 DOM 结构 — 看 #conversation 是否存在
            const probe = await cdpEval(ws, `(() => {
                const conv = document.querySelector('#conversation');
                const panel = document.querySelector('.antigravity-agent-side-panel');
                const chatRows = conv ? conv.querySelectorAll('.leading-relaxed.select-text').length : 0;
                const allMsgs = conv ? conv.querySelectorAll('[class*="space-y"]').length : 0;
                
                // 还要看用户消息
                const userMsgs = conv ? conv.querySelectorAll('[class*="whitespace-pre-wrap"]').length : 0;
                
                return JSON.stringify({
                    hasConversation: !!conv,
                    hasPanel: !!panel,
                    aiMessageCount: chatRows,
                    spaceYCount: allMsgs,
                    userMsgCount: userMsgs,
                    convChildren: conv ? conv.children.length : 0,
                    convHTML: conv ? conv.innerHTML.substring(0, 2000) : '<not found>',
                });
            })()`);

            const info = JSON.parse(probe);
            log(`  #conversation: ${info.hasConversation ? '✅' : '❌'}`);
            log(`  .antigravity-agent-side-panel: ${info.hasPanel ? '✅' : '❌'}`);
            log(`  AI 消息数: ${info.aiMessageCount}`);
            log(`  用户消息数: ${info.userMsgCount}`);
            log(`  #conversation children: ${info.convChildren}`);
            log('');

            if (!info.hasConversation || info.convChildren === 0) {
                log('  ⚠️ 该工作区没有打开的对话，跳过');
                ws.close();
                log('');
                continue;
            }

            // 4. 读取完整对话内容 — 使用 getLastMessage 类似的逻辑但读取所有消息
            const allMessages = await cdpEval(ws, `(() => {
                const conv = document.querySelector('#conversation');
                if (!conv) return JSON.stringify([]);
                
                const messages = [];
                
                // 遍历 #conversation 的直接子元素（每个代表一个 turn）
                for (const child of conv.children) {
                    const text = (child.innerText || '').trim();
                    if (!text) continue;
                    
                    // 判断是否是 AI 回复（包含 .leading-relaxed.select-text）
                    const aiContent = child.querySelector('.leading-relaxed.select-text');
                    
                    // 判断是否是用户消息
                    // 用户消息通常在较简单的容器中
                    const isAiTurn = !!aiContent || text.startsWith('Thought for ');
                    
                    if (isAiTurn) {
                        // 解析 AI 回复的结构化内容
                        const turnData = { role: 'AI', parts: [] };
                        
                        // space-y-2 容器包含多个 block
                        const container = child.querySelector('[class*="space-y-2"]') || child;
                        
                        const toolPrefixes = ['Created', 'Edited', 'Analyzed', 'Ran command', 'Read', 'Searched', 'Listed'];
                        const LF = String.fromCharCode(10);
                        
                        for (const block of container.children) {
                            const blockText = (block.innerText || '').trim();
                            if (!blockText) continue;
                            
                            // Thinking
                            if (blockText.startsWith('Thought for ')) {
                                const thinkContent = block.querySelector('.leading-relaxed.select-text');
                                turnData.parts.push({
                                    type: 'thinking',
                                    label: blockText.split(LF)[0],
                                    content: thinkContent ? thinkContent.innerText.trim() : ''
                                });
                                continue;
                            }
                            
                            // Tool call
                            const isTool = toolPrefixes.some(p => blockText.startsWith(p));
                            if (isTool) {
                                const lines = blockText.split(LF);
                                const uiTexts = ['Relocate', 'Always run', 'Dismiss', 'Run anyway'];
                                const clean = lines.filter(l => !uiTexts.includes(l.trim()));
                                turnData.parts.push({
                                    type: 'tool',
                                    content: clean.join(LF).substring(0, 2000)
                                });
                                continue;
                            }
                            
                            // Reply text
                            const replyEl = block.querySelector('.leading-relaxed.select-text');
                            if (replyEl) {
                                turnData.parts.push({
                                    type: 'reply',
                                    content: replyEl.innerText.trim()
                                });
                            } else {
                                turnData.parts.push({
                                    type: 'text',
                                    content: blockText
                                });
                            }
                        }
                        
                        messages.push(turnData);
                    } else {
                        // 用户消息
                        messages.push({
                            role: 'User',
                            parts: [{ type: 'message', content: text }]
                        });
                    }
                }
                
                return JSON.stringify(messages);
            })()`);

            const msgs = JSON.parse(allMessages);
            log(`✅ 成功提取 ${msgs.length} 条消息`);
            log('');

            // 5. 格式化输出
            for (let i = 0; i < msgs.length; i++) {
                const msg = msgs[i];
                log('━'.repeat(80));
                log(`[${msg.role}] (消息 #${i + 1})`);
                log('━'.repeat(80));

                for (const part of msg.parts) {
                    if (part.type === 'thinking') {
                        log(`🧠 ${part.label}`);
                        if (part.content) {
                            log(part.content);
                        }
                        log('');
                    } else if (part.type === 'tool') {
                        log(`🔧 工具调用:`);
                        log(part.content);
                        log('');
                    } else if (part.type === 'reply') {
                        log(part.content);
                        log('');
                    } else {
                        log(part.content);
                        log('');
                    }
                }
            }

            // 6. 同时输出 DOM 结构原始 HTML（截取前部分用于调试）
            log('');
            log('━'.repeat(80));
            log('原始 HTML 预览 (前 5000 字符):');
            log('━'.repeat(80));
            log(info.convHTML);

            ws.close();
            break; // 成功了就不再试其他工作区

        } catch (e) {
            log(`  ❌ 连接失败: ${e.message}`);
            if (ws) try { ws.close(); } catch { }
            log('');
        }
    }

    fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
    console.log(`\n✅ 结果已保存至: ${outputFile}`);
}

main().catch(err => console.error('Fatal:', err));
