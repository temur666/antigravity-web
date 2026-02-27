/**
 * lib/ide.js — Antigravity IDE 操作层
 *
 * 通过 CDP 操控 IDE 的 Chat 面板，提供发消息、读回复、管理对话等能力。
 * 
 * ========== Chat 面板按钮结构 (2026-02-25 实测) ==========
 * 
 * 顶部工具栏 (y ≈ 42, 各 16×16):
 *   [new-conversation-tooltip]  新建对话 (⚠️ 旧版叫 new-chat-tooltip)
 *   [history-tooltip]           对话历史
 *   [UUID]                      设置按钮 (tooltip 为动态 UUID)
 *   [UUID]                      更多操作 (tooltip 为动态 UUID)
 * 
 * 底部输入区 (y ≈ 411, 各 24×24):
 *   [audio-tooltip]                      语音输入
 *   [input-send-button-send-tooltip]     发送按钮
 * 
 * 隐藏元素 (0×0, 不可见):
 *   [UUID-delete-conversation]           删除对话按钮 (hover 时显示)
 * 
 * ==========================================================
 */

const { sleep, cdpSend, cdpEval } = require('./cdp');

// ========== 常量 ==========

const POLL_INTERVAL_MS = 500;
const STABLE_THRESHOLD = 10;
const MAX_WAIT_S = 300;

// ========== 基础输入操作 ==========

async function focusChatInput(ws) {
    await cdpEval(ws, `(() => {
    const input = document.querySelector('.antigravity-agent-side-panel div[role="textbox"][contenteditable="true"]');
    if (!input) throw new Error('找不到聊天输入框');
    input.focus();
    return 'focused';
  })()`);
}

async function typeText(ws, text) {
    await cdpSend(ws, 'Input.insertText', { text });
}

async function pressEnter(ws) {
    await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
}

async function clickAt(ws, x, y) {
    await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(50);
    await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function pressEsc(ws) {
    await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
}

// ========== 消息读取 ==========

async function getLastMessage(ws) {
    const result = await cdpEval(ws, `
    (() => {
      const conv = document.querySelector('#conversation');
      const empty = { thinking: '', blocks: [], tools: [], reply: '', replyHtml: '', raw: '' };
      if (!conv) return JSON.stringify(empty);
      const aiMessages = conv.querySelectorAll('.leading-relaxed.select-text');
      if (aiMessages.length === 0) return JSON.stringify(empty);
      const lastContent = aiMessages[aiMessages.length - 1];
      let turnContainer = lastContent;
      for (let i = 0; i < 5; i++) {
        const p = turnContainer.parentElement;
        if (!p || p === document.body) break;
        turnContainer = p;
        if (turnContainer.className && turnContainer.className.includes('space-y-2')) break;
      }
      const raw = (turnContainer.innerText || '').trim();
      if (!turnContainer.className || !turnContainer.className.includes('space-y-2')) {
        const reply = (lastContent.innerText || '').trim();
        const replyHtml = lastContent.innerHTML;
        return JSON.stringify({ thinking: '', blocks: [{ type: 'reply', text: reply, html: replyHtml }], tools: [], reply, replyHtml, raw: reply });
      }
      let thinking = '';
      let thinkingHtml = '';
      const blocks = [];
      const tools = [];
      const replyTextParts = [];
      const replyHtmlParts = [];
      const LF = String.fromCharCode(10);
      const toolPrefixes = ['Created', 'Edited', 'Analyzed', 'Ran command', 'Read', 'Searched', 'Listed'];
      for (const child of turnContainer.children) {
        const text = (child.innerText || '').trim();
        if (!text) continue;
        if (text.startsWith('Thought for ')) {
          const contentEl = child.querySelector('.leading-relaxed.select-text');
          let rawThinkingHtml = contentEl ? contentEl.innerHTML : '';
          rawThinkingHtml = rawThinkingHtml.replace(/<style[^>]*>[\\\\s\\\\S]*?<\\\\/style>/gi, '');
          thinkingHtml = rawThinkingHtml;
          const clone = child.cloneNode(true);
          const nested = clone.querySelector('.leading-relaxed.select-text');
          if (nested) nested.remove();
          thinking = (clone.innerText || '').trim();
          continue;
        }
        const isTool = toolPrefixes.some(prefix => text.startsWith(prefix));
        if (isTool) {
          const lines = text.split(LF);
          const uiTexts = ['Relocate', 'Always run', 'Dismiss', 'Run anyway'];
          const cleanLines = lines.filter(l => !uiTexts.includes(l.trim()));
          const summary = cleanLines.slice(0, 4).join(LF).substring(0, 500);
          tools.push(summary);
          blocks.push({ type: 'tool', text: summary, html: child.innerHTML });
          continue;
        }
        const contentEl = child.querySelector('.leading-relaxed.select-text');
        if (contentEl) {
          const cText = (contentEl.innerText || '').trim();
          const cHtml = contentEl.innerHTML;
          blocks.push({ type: 'reply', text: cText, html: cHtml });
          replyHtmlParts.push(cHtml);
          replyTextParts.push(cText);
        } else {
          blocks.push({ type: 'reply', text: text, html: '' });
          replyTextParts.push(text);
        }
      }
      const reply = replyTextParts.join(LF + LF).trim();
      const replyHtml = replyHtmlParts.join(LF).trim();
      return JSON.stringify({ thinking, thinkingHtml, blocks, tools, reply, replyHtml, raw });
    })()`);
    try { return JSON.parse(result); }
    catch { return { thinking: '', blocks: [], tools: [], reply: result || '', replyHtml: '', raw: result || '' }; }
}

async function getLastMessageText(ws) {
    const msg = await getLastMessage(ws);
    return msg.reply;
}

async function getLastMessageLength(ws) {
    const len = await cdpEval(ws, `(() => {
    const conv = document.querySelector('#conversation');
    if (!conv) return 0;
    const msgs = conv.querySelectorAll('.leading-relaxed.select-text');
    if (msgs.length === 0) return 0;
    const last = msgs[msgs.length - 1];
    let container = last;
    for (let i = 0; i < 5; i++) {
      const p = container.parentElement;
      if (!p || p === document.body) break;
      container = p;
      if (container.className && container.className.includes('space-y-2')) break;
    }
    return (container.innerText || '').length;
  })()`);
    return len || 0;
}

// ========== 生成状态检测 ==========

async function isGenerating(ws) {
    try {
        const result = await cdpEval(ws, `(() => {
      const stopSelectors = [
        'button[aria-label*="stop" i]', 'button[aria-label*="cancel" i]',
        'button[aria-label*="Stop"]', 'button[aria-label*="Cancel"]',
        'button[title*="stop" i]', 'button[title*="cancel" i]',
        '[class*="stop-button"]', '[class*="stopButton"]',
        '[data-testid*="stop"]', '[data-action="stop"]',
      ];
      for (const sel of stopSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el && (el.offsetParent !== null || el.offsetWidth > 0)) return JSON.stringify({ generating: true, signal: 'stop-button' });
        } catch {}
      }
      const panel = document.querySelector('.antigravity-agent-side-panel') || document;
      const animSelectors = ['.animate-spin', '.animate-pulse', '[class*="loading"]', '[class*="spinner"]', '[class*="generating"]'];
      for (const sel of animSelectors) {
        try {
          const el = panel.querySelector(sel);
          if (el && (el.offsetParent !== null || el.offsetWidth > 0)) return JSON.stringify({ generating: true, signal: 'animation' });
        } catch {}
      }
      const input = document.querySelector('.antigravity-agent-side-panel div[role="textbox"]');
      if (input) {
        if (input.contentEditable === 'false' || input.getAttribute('disabled') !== null || input.getAttribute('aria-disabled') === 'true')
          return JSON.stringify({ generating: true, signal: 'input-disabled' });
      }
      return JSON.stringify({ generating: false, signal: 'none' });
    })()`);
        const parsed = JSON.parse(result);
        return parsed.generating;
    } catch { return null; }
}

// ========== 截屏 ==========

async function takeScreenshot(ws) {
    const result = await cdpSend(ws, 'Page.captureScreenshot', { format: 'png', quality: 80 });
    return result.data; // base64
}

// ========== 对话历史管理 ==========

async function isModalOpen(ws) {
    return await cdpEval(ws, `!!document.querySelector('.jetski-fast-pick')`);
}

async function openHistoryModal(ws) {
    if (await isModalOpen(ws)) { await pressEsc(ws); await sleep(300); }
    const raw = await cdpEval(ws, `(() => {
    const btn = document.querySelector('[data-tooltip-id="history-tooltip"]');
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
  })()`);
    if (!raw) throw new Error('未找到 history 按钮');
    const { x, y } = JSON.parse(raw);
    await clickAt(ws, x, y);
    await sleep(800);
}

async function closeHistoryModal(ws) {
    if (await isModalOpen(ws)) { await pressEsc(ws); await sleep(300); }
}

async function getConversationList(ws) {
    const raw = await cdpEval(ws, `(() => {
    const modal = document.querySelector('.jetski-fast-pick');
    if (!modal) return JSON.stringify({ current: null, recent: [] });
    const scrollList = modal.querySelector('.overflow-y-scroll');
    if (!scrollList) return JSON.stringify({ current: null, recent: [] });
    let current = null;
    const recent = [];
    let idx = 0;
    const groups = scrollList.querySelectorAll(':scope > .flex.flex-col.gap-0\\\\.5');
    for (const group of groups) {
      const labelEl = group.querySelector('.text-xs.opacity-50');
      const label = labelEl ? labelEl.textContent.trim() : '';
      const isCurrent = label === 'Current';
      const items = group.querySelectorAll(':scope > .cursor-pointer');
      for (const item of items) {
        const titleEl = item.querySelector('.text-sm.truncate span');
        const timeEl = item.querySelector('.text-xs.opacity-50.ml-4');
        if (!titleEl) continue;
        const conv = { title: titleEl.textContent.trim(), time: timeEl ? timeEl.textContent.trim() : '', index: idx, isCurrent };
        if (isCurrent) current = conv;
        else recent.push(conv);
        idx++;
      }
    }
    return JSON.stringify({ current, recent });
  })()`);
    return JSON.parse(raw);
}

async function clickConversation(ws, index) {
    const raw = await cdpEval(ws, `(() => {
    const modal = document.querySelector('.jetski-fast-pick');
    if (!modal) return null;
    const scrollList = modal.querySelector('.overflow-y-scroll');
    if (!scrollList) return null;
    const items = scrollList.querySelectorAll('.cursor-pointer.flex.items-center.justify-between');
    const target = items[${index}];
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
  })()`);
    if (!raw) throw new Error(`未找到 index=${index} 的对话`);
    const { x, y } = JSON.parse(raw);
    await clickAt(ws, x, y);
    await sleep(500);
}

async function createNewChat(ws) {
    if (await isModalOpen(ws)) { await closeHistoryModal(ws); await sleep(300); }
    const raw = await cdpEval(ws, `(() => {
    // 优先使用当前版本的 tooltip 名称
    let btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
    // 兜底: 旧版名称
    if (!btn) btn = document.querySelector('[data-tooltip-id="new-chat-tooltip"]');
    // 再兜底: history 按钮的前一个兄弟元素
    if (!btn) {
      const histBtn = document.querySelector('[data-tooltip-id="history-tooltip"]');
      if (histBtn) btn = histBtn.previousElementSibling;
    }
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
  })()`);
    if (!raw) throw new Error('未找到新建对话按钮');
    const { x, y } = JSON.parse(raw);
    await clickAt(ws, x, y);
    await sleep(500);
}

// ========== 流式等待回复 ==========

async function waitForResponseStream(ws, textBefore, onUpdate) {
    const startTime = Date.now();
    let lastLength = 0;
    let lastMsg = { thinking: '', reply: '', raw: '' };
    let stableCount = 0;
    let responseStarted = false;
    let generatingSignalWorking = false;

    while (true) {
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > MAX_WAIT_S) return { ...lastMsg, timedOut: true };

        await sleep(POLL_INTERVAL_MS);

        try {
            const currentLength = await getLastMessageLength(ws);

            if (!responseStarted) {
                if (currentLength !== lastLength && currentLength > 0) {
                    const currentMsg = await getLastMessage(ws);
                    if (currentMsg.reply !== textBefore && currentMsg.raw.length > 0) {
                        responseStarted = true;
                        lastMsg = currentMsg;
                        lastLength = currentLength;
                        if (onUpdate) await onUpdate(currentMsg);
                        const genCheck = await isGenerating(ws);
                        if (genCheck === true) generatingSignalWorking = true;
                    }
                }
                continue;
            }

            if (currentLength === lastLength) {
                stableCount++;
                if (stableCount >= STABLE_THRESHOLD || (generatingSignalWorking && stableCount >= 3)) {
                    const still = await isGenerating(ws);
                    if (still === true) { stableCount = 0; continue; }
                    const finalMsg = await getLastMessage(ws);
                    return { ...finalMsg, timedOut: false };
                }
            } else {
                stableCount = 0;
                lastLength = currentLength;
                const currentMsg = await getLastMessage(ws);
                lastMsg = currentMsg;
                if (onUpdate) await onUpdate(currentMsg);
            }
        } catch { }
    }
}

module.exports = {
    focusChatInput,
    typeText,
    pressEnter,
    clickAt,
    pressEsc,
    getLastMessage,
    getLastMessageText,
    getLastMessageLength,
    isGenerating,
    takeScreenshot,
    isModalOpen,
    openHistoryModal,
    closeHistoryModal,
    getConversationList,
    clickConversation,
    createNewChat,
    waitForResponseStream,
};
