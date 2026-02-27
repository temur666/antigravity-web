/**
 * format-trajectory.js — 将 trajectory JSON 格式化为可读的对话文本
 * 
 * Usage: node tools/format-trajectory.js [json-file]
 * Default: tools/trajectory-038f30bc-GetCascadeTrajectory.json
 */
const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2] || path.join(__dirname, 'trajectory-038f30bc-GetCascadeTrajectory.json');
const outputFile = inputFile.replace(/\.json$/, '-formatted.txt');

const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
const t = data.trajectory;

const lines = [];
const log = (l = '') => lines.push(l);

log('═'.repeat(80));
log(`对话 ID: ${t.cascadeId}`);
log(`Trajectory ID: ${t.trajectoryId}`);
log(`类型: ${t.trajectoryType}`);
log(`步骤数: ${t.steps?.length || 0}`);
log(`总步骤: ${data.numTotalSteps}`);
if (t.metadata) {
    log(`创建时间: ${t.metadata.createdAt || ''}`);
    log(`更新时间: ${t.metadata.updatedAt || ''}`);
}
if (t.source) {
    log(`来源: ${JSON.stringify(t.source).substring(0, 200)}`);
}
log('═'.repeat(80));
log('');

for (let i = 0; i < (t.steps || []).length; i++) {
    const step = t.steps[i];
    const typeName = (step.type || '').replace('CORTEX_STEP_TYPE_', '');

    log('━'.repeat(80));
    log(`Step #${i} — ${typeName}`);
    log(`Status: ${(step.status || '').replace('CORTEX_STEP_STATUS_', '')}`);
    if (step.metadata?.createdAt) log(`时间: ${step.metadata.createdAt}`);
    log('━'.repeat(80));

    switch (typeName) {
        case 'USER_INPUT': {
            const ui = step.userInput;
            if (ui) {
                if (ui.userResponse) {
                    log(`\n[用户消息]`);
                    log(ui.userResponse);
                }
                if (ui.items && ui.items.length > 0) {
                    for (const item of ui.items) {
                        if (item.text && item.text !== ui.userResponse) {
                            log(`  附加文本: ${item.text}`);
                        }
                        if (item.imageUri) log(`  图片: ${item.imageUri}`);
                    }
                }
                if (ui.activeUserState?.activeDocument) {
                    const doc = ui.activeUserState.activeDocument;
                    log(`  当前文件: ${doc.absoluteUri}`);
                    log(`  工作区: ${doc.workspaceUri}`);
                    log(`  语言: ${doc.language}`);
                }
            }
            break;
        }
        case 'PLANNER_RESPONSE': {
            const pr = step.plannerResponse;
            if (pr) {
                log(`\n[AI 回复]`);
                if (pr.rawThinkingText) {
                    log(`\n🧠 思考过程:`);
                    log(pr.rawThinkingText.substring(0, 5000));
                    if (pr.rawThinkingText.length > 5000) log(`... [截断，总 ${pr.rawThinkingText.length} 字符]`);
                }
                if (pr.reply || pr.text || pr.content) {
                    log(`\n📝 回复:`);
                    log((pr.reply || pr.text || pr.content || '').substring(0, 10000));
                }
                // 工具调用
                if (pr.steps && pr.steps.length > 0) {
                    for (const s of pr.steps) {
                        if (s.toolCall) {
                            log(`\n🔧 工具: ${s.toolCall.toolName || s.toolCall.name || 'unknown'}`);
                            if (s.toolCall.parameters) {
                                const params = typeof s.toolCall.parameters === 'string'
                                    ? s.toolCall.parameters
                                    : JSON.stringify(s.toolCall.parameters, null, 2);
                                log(params.substring(0, 2000));
                            }
                        }
                        if (s.toolResult) {
                            log(`\n📋 工具结果:`);
                            const result = typeof s.toolResult === 'string'
                                ? s.toolResult
                                : JSON.stringify(s.toolResult).substring(0, 2000);
                            log(result.substring(0, 2000));
                        }
                    }
                }
                // 直接检查所有子键
                for (const [key, val] of Object.entries(pr)) {
                    if (['rawThinkingText', 'reply', 'text', 'content', 'steps'].includes(key)) continue;
                    if (typeof val === 'string' && val.length > 20) {
                        log(`\n  [${key}]: ${val.substring(0, 3000)}`);
                    }
                }
            }
            break;
        }
        case 'CONVERSATION_HISTORY': {
            const ch = step.conversationHistory;
            if (ch) {
                log(`\n[对话历史上下文]`);
                const json = JSON.stringify(ch);
                if (json.length > 100) {
                    log(`  (${json.length} bytes 的上下文数据)`);
                    // 搜索文本内容
                    if (ch.messages) {
                        log(`  消息数: ${ch.messages.length}`);
                        for (const msg of ch.messages.slice(0, 5)) {
                            log(`  - ${msg.role}: ${(msg.content || msg.text || '').substring(0, 200)}`);
                        }
                    }
                } else {
                    log(`  ${json}`);
                }
            }
            break;
        }
        case 'EPHEMERAL_MESSAGE': {
            const em = step.ephemeralMessage;
            if (em) {
                log(`\n[系统/临时消息]`);
                if (em.text) log(em.text.substring(0, 5000));
                if (em.content) log(em.content.substring(0, 5000));
                // 全部键值
                for (const [key, val] of Object.entries(em)) {
                    if (['text', 'content'].includes(key)) continue;
                    if (typeof val === 'string' && val.length > 0) {
                        log(`  ${key}: ${val.substring(0, 1000)}`);
                    }
                }
            }
            break;
        }
        case 'SEARCH_WEB': {
            const sw = step.searchWeb;
            if (sw) {
                log(`\n[网页搜索]`);
                if (sw.query) log(`  搜索: ${sw.query}`);
                if (sw.results) {
                    log(`  结果数: ${sw.results.length}`);
                    for (const r of sw.results.slice(0, 5)) {
                        log(`  - ${r.title || ''}: ${r.url || ''}`);
                        if (r.snippet) log(`    ${r.snippet.substring(0, 200)}`);
                    }
                }
                const json = JSON.stringify(sw);
                if (json.length > 50) log(`  原始 (${json.length} bytes)`);
            }
            break;
        }
        case 'CHECKPOINT': {
            log(`\n[检查点]`);
            if (step.checkpoint) log(JSON.stringify(step.checkpoint).substring(0, 1000));
            break;
        }
        case 'KNOWLEDGE_ARTIFACTS': {
            log(`\n[知识工件]`);
            if (step.knowledgeArtifacts) {
                const json = JSON.stringify(step.knowledgeArtifacts);
                log(`  (${json.length} bytes)`);
            }
            break;
        }
        default: {
            log(`\n[${typeName}]`);
            // 打印所有非 type/status/metadata 的键
            for (const [key, val] of Object.entries(step)) {
                if (['type', 'status', 'metadata'].includes(key)) continue;
                const str = typeof val === 'string' ? val : JSON.stringify(val);
                log(`  ${key}: ${str.substring(0, 2000)}`);
            }
        }
    }
    log('');
}

// 额外信息
if (t.generatorMetadata && t.generatorMetadata.length > 0) {
    log('\n═'.repeat(80));
    log('Generator Metadata:');
    for (const gm of t.generatorMetadata) {
        log(`  model: ${gm.model || gm.modelId || ''}`);
        if (gm.modelName) log(`  modelName: ${gm.modelName}`);
        log(`  ${JSON.stringify(gm).substring(0, 500)}`);
    }
}

fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
console.log(`✅ 已格式化 ${t.steps?.length || 0} 个步骤到: ${outputFile} (${lines.length} 行)`);
