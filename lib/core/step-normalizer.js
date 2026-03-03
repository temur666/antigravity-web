/**
 * lib/core/step-normalizer.js — Step 数据规范化层
 *
 * LS gRPC 返回的 step 数据结构与前端约定不完全一致。
 * 本模块将原始 step 规范化为前端期望的 Schema，
 * 使下游消费者（前端 / Telegram / 未来客户端）无需关心 LS 协议细节。
 *
 * 原则:
 *   - 只做字段映射 + 提取，不做业务逻辑
 *   - 保留原始字段(_raw)，方便 debug
 *   - 未识别的 step 类型原样透传
 */

// ========== 工具函数 ==========

/**
 * 从 file:///path/to/file 格式提取文件路径
 * @param {string} uri - file URI (e.g. "file:///home/user/foo.ts")
 * @returns {string} 文件路径 (e.g. "/home/user/foo.ts")
 */
function uriToPath(uri) {
    if (!uri) return '';
    if (uri.startsWith('file:///')) return uri.slice(7);
    if (uri.startsWith('file://')) return uri.slice(6);
    return uri;
}

/**
 * 将 replacementChunks 数组转换为 unified diff 文本
 * @param {Array} chunks - LS 的 replacementChunks
 * @returns {string} diff 文本
 */
function chunksToDiff(chunks) {
    if (!chunks || chunks.length === 0) return '';

    const parts = [];
    for (const chunk of chunks) {
        const target = chunk.targetContent || '';
        const replacement = chunk.replacementContent || '';
        if (target === replacement) continue;

        const range = chunk.startLine && chunk.endLine
            ? `@@ L${chunk.startLine}-${chunk.endLine} @@`
            : '@@';

        const removed = target.split('\n').map(l => `- ${l}`).join('\n');
        const added = replacement.split('\n').map(l => `+ ${l}`).join('\n');
        parts.push(`${range}\n${removed}\n${added}`);
    }
    return parts.join('\n\n');
}

// ========== 各类型 Normalizer ==========

function normalizeViewFile(raw) {
    return {
        filePath: uriToPath(raw.absolutePathUri) || raw.filePath || '',
        content: raw.content || '',
        startLine: raw.startLine,
        endLine: raw.endLine,
        numLines: raw.numLines,
        numBytes: raw.numBytes,
    };
}

function normalizeCodeAction(raw) {
    const cmd = raw.actionSpec?.command || {};
    const filePath = uriToPath(cmd.file?.absoluteUri) || raw.filePath || '';

    // 从 replacementChunks 生成 diff
    const diff = chunksToDiff(cmd.replacementChunks);

    return {
        filePath,
        diff,
        description: raw.description || cmd.instruction || '',
        markdownLanguage: raw.markdownLanguage || '',
        acknowledgementType: raw.acknowledgementType || '',
        // 保留结构化数据供高级 UI 使用
        replacementChunks: cmd.replacementChunks || [],
        replacementInfos: raw.replacementInfos || [],
    };
}

function normalizeRunCommand(raw) {
    // combinedOutput: LS 有时返回空对象 {}，需要兼容
    const co = raw.combinedOutput || {};
    const fullOutput = co.full || co.output || '';

    return {
        command: raw.commandLine || raw.proposedCommandLine || raw.command || '',
        commandLine: raw.commandLine || '',
        proposedCommandLine: raw.proposedCommandLine || '',
        cwd: raw.cwd || '',
        waitMsBeforeAsync: raw.waitMsBeforeAsync,
        shouldAutoRun: raw.shouldAutoRun || false,
        blocking: raw.blocking || false,
        exitCode: raw.exitCode,
        autoRunDecision: raw.autoRunDecision || '',
        combinedOutput: { full: fullOutput },
    };
}

function normalizeCommandStatus(raw) {
    return {
        commandId: raw.commandId || '',
        outputCharacterCount: raw.outputCharacterCount,
        waitDurationSeconds: raw.waitDurationSeconds,
        status: raw.status || '',
        combined: raw.combined || '',
        delta: raw.delta || '',
        exitCode: raw.exitCode,
    };
}

function normalizeListDirectory(raw) {
    // LS: directoryPathUri + results
    // 前端: path + entries
    const path = uriToPath(raw.directoryPathUri) || raw.path || '';

    // results → entries 映射
    let entries = raw.entries;
    if (!entries && raw.results) {
        entries = raw.results;
    }

    return {
        path,
        directoryPathUri: raw.directoryPathUri || '',
        entries: entries || [],
    };
}

function normalizeErrorMessage(raw) {
    // LS 的 error 字段是对象: { userErrorMessage, modelErrorMessage, shortError, fullError }
    const err = raw.error || {};
    const message = typeof err === 'string'
        ? err
        : (err.userErrorMessage || err.shortError || err.modelErrorMessage || raw.message || '');

    return {
        message,
        code: err.shortError || raw.code || '',
        fullError: typeof err === 'object' ? err.fullError || '' : '',
    };
}

function normalizeSearchWeb(raw) {
    return {
        query: raw.query || '',
        results: raw.results || [],
    };
}

function normalizeUserInput(raw) {
    return {
        items: raw.items || [],
    };
}

function normalizePlannerResponse(raw) {
    return {
        thinking: raw.thinking || '',
        response: raw.response || '',
        toolCalls: raw.toolCalls || [],
        thinkingDuration: raw.thinkingDuration,
        stopReason: raw.stopReason,
    };
}

function normalizeCheckpoint(raw) {
    return {
        userIntent: raw.userIntent || '',
    };
}

function normalizeNotifyUser(raw) {
    return {
        message: raw.message || '',
    };
}

// 新增类型: LS 有但前端尚未定义的
function normalizeViewFileOutline(raw) {
    return {
        filePath: uriToPath(raw.absolutePathUri) || '',
        outlineItems: raw.outlineItems || [],
        numLines: raw.numLines,
        numBytes: raw.numBytes,
    };
}

function normalizeViewCodeItem(raw) {
    // LS: absoluteUri + ccis[].snippetByType
    const ccis = raw.ccis || [];
    const items = ccis.map(c => {
        const snippets = c.snippetByType || {};
        return {
            nodeName: c.nodeName || '',
            startLine: c.startLine,
            endLine: c.endLine,
            contextType: (c.contextType || '').replace('CODE_CONTEXT_TYPE_', ''),
            language: (c.language || '').replace('LANGUAGE_', ''),
            snippet: snippets['CONTEXT_SNIPPET_TYPE_RAW_SOURCE']?.snippet || '',
            signature: snippets['CONTEXT_SNIPPET_TYPE_SIGNATURE']?.snippet || '',
            absoluteUri: c.absoluteUri || '',
        };
    });

    return {
        filePath: uriToPath(raw.absoluteUri) || '',
        nodePaths: raw.nodePaths || [],
        items,
    };
}

function normalizeGrepSearch(raw) {
    // LS results: { relativePath, absolutePath, content, lineNumber }
    // 前端期望: { file, lineNumber, lineContent }
    const rawResults = raw.results || [];
    const results = rawResults.map(r => ({
        file: r.absolutePath || r.relativePath || r.file || '',
        lineNumber: r.lineNumber ?? 0,
        lineContent: r.content || r.lineContent || '',
    }));

    return {
        searchPath: uriToPath(raw.searchPathUri) || raw.searchPath || '',
        query: raw.query || '',
        results,
        totalResults: raw.totalResults || results.length,
        matchPerLine: raw.matchPerLine || false,
    };
}

function normalizeFind(raw) {
    return {
        searchDirectory: raw.searchDirectory || '',
        pattern: raw.pattern || '',
        totalResults: raw.totalResults || 0,
    };
}

// ========== 主入口 ==========

/**
 * payload key 与 step type 的映射
 */
const PAYLOAD_KEYS = {
    'CORTEX_STEP_TYPE_USER_INPUT': 'userInput',
    'CORTEX_STEP_TYPE_PLANNER_RESPONSE': 'plannerResponse',
    'CORTEX_STEP_TYPE_VIEW_FILE': 'viewFile',
    'CORTEX_STEP_TYPE_VIEW_FILE_OUTLINE': 'viewFileOutline',
    'CORTEX_STEP_TYPE_VIEW_CODE_ITEM': 'viewCodeItem',
    'CORTEX_STEP_TYPE_CODE_ACTION': 'codeAction',
    'CORTEX_STEP_TYPE_RUN_COMMAND': 'runCommand',
    'CORTEX_STEP_TYPE_COMMAND_STATUS': 'commandStatus',
    'CORTEX_STEP_TYPE_LIST_DIRECTORY': 'listDirectory',
    'CORTEX_STEP_TYPE_NOTIFY_USER': 'notifyUser',
    'CORTEX_STEP_TYPE_ERROR_MESSAGE': 'errorMessage',
    'CORTEX_STEP_TYPE_CHECKPOINT': 'checkpoint',
    'CORTEX_STEP_TYPE_SEARCH_WEB': 'searchWeb',
    'CORTEX_STEP_TYPE_GREP_SEARCH': 'grepSearch',
    'CORTEX_STEP_TYPE_FIND': 'find',
    'CORTEX_STEP_TYPE_CODE_ACKNOWLEDGEMENT': 'codeAcknowledgement',
};

const NORMALIZERS = {
    'CORTEX_STEP_TYPE_USER_INPUT': normalizeUserInput,
    'CORTEX_STEP_TYPE_PLANNER_RESPONSE': normalizePlannerResponse,
    'CORTEX_STEP_TYPE_VIEW_FILE': normalizeViewFile,
    'CORTEX_STEP_TYPE_VIEW_FILE_OUTLINE': normalizeViewFileOutline,
    'CORTEX_STEP_TYPE_VIEW_CODE_ITEM': normalizeViewCodeItem,
    'CORTEX_STEP_TYPE_CODE_ACTION': normalizeCodeAction,
    'CORTEX_STEP_TYPE_RUN_COMMAND': normalizeRunCommand,
    'CORTEX_STEP_TYPE_COMMAND_STATUS': normalizeCommandStatus,
    'CORTEX_STEP_TYPE_LIST_DIRECTORY': normalizeListDirectory,
    'CORTEX_STEP_TYPE_NOTIFY_USER': normalizeNotifyUser,
    'CORTEX_STEP_TYPE_ERROR_MESSAGE': normalizeErrorMessage,
    'CORTEX_STEP_TYPE_CHECKPOINT': normalizeCheckpoint,
    'CORTEX_STEP_TYPE_SEARCH_WEB': normalizeSearchWeb,
    'CORTEX_STEP_TYPE_GREP_SEARCH': normalizeGrepSearch,
    'CORTEX_STEP_TYPE_FIND': normalizeFind,
};

/**
 * 规范化单个 step
 * @param {object} rawStep - LS 返回的原始 step
 * @returns {object} 规范化后的 step
 */
function normalizeStep(rawStep) {
    if (!rawStep || !rawStep.type) return rawStep;

    const { type, status, metadata } = rawStep;
    const payloadKey = PAYLOAD_KEYS[type];
    const normalizer = NORMALIZERS[type];

    // 有 normalizer → 转换 payload
    if (payloadKey && normalizer && rawStep[payloadKey]) {
        return {
            type,
            status,
            metadata,
            [payloadKey]: normalizer(rawStep[payloadKey]),
        };
    }

    // 无 normalizer（如 EPHEMERAL_MESSAGE、TASK_BOUNDARY 等系统类型）→ 原样透传
    return rawStep;
}

/**
 * 规范化 steps 数组
 * @param {Array} steps - 原始 steps 数组
 * @returns {Array} 规范化后的 steps
 */
function normalizeSteps(steps) {
    if (!Array.isArray(steps)) return [];
    return steps.map(normalizeStep);
}

module.exports = {
    normalizeStep,
    normalizeSteps,
    uriToPath,
    chunksToDiff,
    // 导出各 normalizer 供单测使用
    normalizeViewFile,
    normalizeCodeAction,
    normalizeRunCommand,
    normalizeCommandStatus,
    normalizeListDirectory,
    normalizeErrorMessage,
};
