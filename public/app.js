/**
 * Antigravity Web Chat — 前端逻辑
 */

// ========== WebSocket 连接 ==========
let ws = null;
let wsConnected = false;

function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
        wsConnected = true;
        console.log('✅ WebSocket 已连接');
    };

    ws.onclose = () => {
        wsConnected = false;
        console.log('⚠️ WebSocket 断开，3s 后重连...');
        setTimeout(connectWS, 3000);
    };

    ws.onerror = (err) => {
        console.error('❌ WebSocket 错误');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
    };
}

function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// ========== 消息处理 ==========

let currentBotMsgEl = null; // 当前正在流式更新的 bot 消息元素

function handleServerMessage(data) {
    switch (data.type) {
        case 'cdp_status':
            updateCDPStatus(data.connected);
            break;

        case 'status':
            showStatus(data.message);
            break;

        case 'stream':
            updateBotMessage(data, true);
            break;

        case 'reply':
            updateBotMessage(data, false);
            removeStatus();
            break;

        case 'error':
            showErrorMessage(data.message);
            removeStatus();
            break;

        case 'screenshot':
            showScreenshot(data.data);
            break;

        case 'new_chat_ok':
            showToast('✅ 新对话已创建');
            clearMessages();
            break;

        case 'chat_list':
            renderChatList(data);
            break;

        case 'open_chat_ok':
            showToast(`✅ 已切换到对话 #${data.index}`);
            break;
    }
}

// ========== UI 更新 ==========

function updateCDPStatus(connected) {
    const el = document.getElementById('cdp-status');
    const textEl = el.querySelector('.cdp-text');
    el.className = `cdp-status ${connected ? 'connected' : 'disconnected'}`;
    textEl.textContent = connected ? 'CDP 已连接' : 'CDP 未连接';
    document.getElementById('header-subtitle').textContent = connected ? '已连接 · 远程 AI 对话' : '未连接';
}

function getTimeStr() {
    const now = new Date();
    return now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function clearMessages() {
    const container = document.getElementById('messages');
    container.innerHTML = `
    <div class="welcome-message">
      <div class="welcome-icon">✦</div>
      <h2>新对话</h2>
      <p>发送消息开始对话</p>
    </div>`;
    currentBotMsgEl = null;
}

function removeWelcome() {
    const welcome = document.querySelector('.welcome-message');
    if (welcome) welcome.remove();
}

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
    });
}

// ========== 添加用户消息 ==========

function addUserMessage(text) {
    removeWelcome();
    const container = document.getElementById('messages');
    const html = `
    <div class="message-bubble user">
      <div class="msg-content">
        <div class="msg-body">${escapeHtml(text)}</div>
        <div class="msg-time">${getTimeStr()}</div>
      </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html);
    scrollToBottom();
}

// ========== Bot 消息（流式更新） ==========

function updateBotMessage(data, isStreaming) {
    removeWelcome();
    const container = document.getElementById('messages');

    if (!currentBotMsgEl) {
        // 创建新的 bot 消息
        const wrapper = document.createElement('div');
        wrapper.className = 'message-bubble bot';
        wrapper.innerHTML = `
      <div class="msg-avatar">✦</div>
      <div class="msg-content">
        <div class="msg-body-wrapper"></div>
        <div class="msg-time">${getTimeStr()}</div>
      </div>`;
        container.appendChild(wrapper);
        currentBotMsgEl = wrapper.querySelector('.msg-body-wrapper');
    }

    // 构建消息内容
    let html = '';

    // Thinking
    if (data.thinking) {
        const cleanedThinking = cleanThinkingText(data.thinking);
        const cleanedThinkingHtml = data.thinkingHtml ? sanitizeHtml(data.thinkingHtml) : '';
        if (cleanedThinking) {
            html += `<div class="thinking-block" onclick="this.classList.toggle('expanded')">
        <div class="thinking-header">
          <span class="chevron">▶</span>
          <span>💭 ${escapeHtml(cleanedThinking)}</span>
        </div>
        <div class="thinking-content">${cleanedThinkingHtml || escapeHtml(cleanedThinking)}</div>
      </div>`;
        }
    }

    // Blocks（工具 + 正文，按顺序）
    if (data.blocks && data.blocks.length > 0) {
        for (const block of data.blocks) {
            if (block.type === 'tool') {
                html += `<div class="tool-block">${escapeHtml(block.text)}</div>`;
            } else if (block.type === 'reply') {
                if (block.html) {
                    html += `<div class="msg-body">${sanitizeHtml(block.html)}</div>`;
                } else {
                    html += `<div class="msg-body">${formatTextToHtml(block.text)}</div>`;
                }
            }
        }
    } else if (data.replyHtml) {
        html += `<div class="msg-body">${sanitizeHtml(data.replyHtml)}</div>`;
    } else if (data.reply) {
        html += `<div class="msg-body">${formatTextToHtml(data.reply)}</div>`;
    }

    // 流式进行中指示
    if (isStreaming) {
        html += `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
    }

    if (data.timedOut) {
        html += `<div class="tool-block" style="border-left-color: var(--orange);">⚠️ 等待超时</div>`;
    }

    currentBotMsgEl.innerHTML = html;

    if (!isStreaming) {
        currentBotMsgEl = null; // 完成，重置
    }

    scrollToBottom();
}

// ========== HTML 安全处理 ==========

function sanitizeHtml(html) {
    // 保留安全的 HTML 标签，移除 script/style/event handlers
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<link[^>]*stylesheet[^>]*>/gi, '')
        .replace(/\son\w+="[^"]*"/gi, '')
        .replace(/\son\w+='[^']*'/gi, '');
}

function cleanThinkingText(text) {
    // 去掉 CSS 泄漏文本（以 /* 或 @media 或 .markdown 等开头的 CSS 块）
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')  // /* ... */ 注释
        .replace(/@media[\s\S]*?\}\s*\}/g, '')  // @media 块
        .replace(/\.[\w-]+\s*\{[\s\S]*?\}/g, '')  // .class { ... } 规则
        .replace(/\s{2,}/g, ' ')  // 多余空白
        .trim();
}

function formatTextToHtml(text) {
    if (!text) return '';
    // 简单的 Markdown 转换
    let result = escapeHtml(text);
    // 代码块
    result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        return `<pre><code class="language-${lang}">${code}</code></pre>`;
    });
    // 内联代码
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 粗体
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 斜体
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // 换行
    result = result.replace(/\n/g, '<br>');
    return result;
}

// ========== 状态消息 ==========

function showStatus(message) {
    removeStatus();
    const container = document.getElementById('messages');
    const html = `
    <div class="status-message" id="current-status">
      <div class="status-text">
        <div class="status-spinner"></div>
        <span>${escapeHtml(message)}</span>
      </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html);
    scrollToBottom();
}

function removeStatus() {
    const el = document.getElementById('current-status');
    if (el) el.remove();
}

function showErrorMessage(message) {
    const container = document.getElementById('messages');
    const html = `
    <div class="message-bubble bot">
      <div class="msg-avatar" style="background: linear-gradient(135deg, #5c2020, #3a1515);">⚠️</div>
      <div class="msg-content">
        <div class="msg-body" style="background: rgba(229,57,53,0.1); border-left: 3px solid var(--red);">
          ${escapeHtml(message)}
        </div>
        <div class="msg-time">${getTimeStr()}</div>
      </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html);
    currentBotMsgEl = null;
    scrollToBottom();
}

// ========== Toast ==========

function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      background: var(--bg-modal); color: var(--text-primary);
      padding: 10px 20px; border-radius: 12px; font-size: 13px;
      border: 1px solid var(--border-light); box-shadow: 0 8px 30px rgba(0,0,0,0.3);
      z-index: 2000; animation: fadeIn 0.2s ease;
      transition: opacity 0.3s;
    `;
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, 2000);
}

// ========== 截屏 ==========

function showScreenshot(base64) {
    const modal = document.getElementById('screenshot-modal');
    const img = document.getElementById('screenshot-img');
    img.src = `data:image/png;base64,${base64}`;
    modal.style.display = 'flex';
}

// ========== 对话列表 ==========

function renderChatList(data) {
    const list = document.getElementById('chat-list');
    let html = '';

    if (data.current) {
        html += `<div class="chat-item active" data-index="${data.current.index}">
      <div class="chat-item-icon">💬</div>
      <div class="chat-item-info">
        <div class="chat-item-title">${escapeHtml(data.current.title)}</div>
        <div class="chat-item-time">${data.current.time || '当前'}</div>
      </div>
      <div class="chat-item-badge">当前</div>
    </div>`;
    }

    if (data.recent && data.recent.length > 0) {
        for (const conv of data.recent) {
            html += `<div class="chat-item" data-index="${conv.index}" onclick="openChat(${conv.index})">
        <div class="chat-item-icon">📝</div>
        <div class="chat-item-info">
          <div class="chat-item-title">${escapeHtml(conv.title)}</div>
          <div class="chat-item-time">${escapeHtml(conv.time || '')}</div>
        </div>
      </div>`;
        }
    }

    if (!html) {
        html = '<div class="chat-list-empty">暂无对话</div>';
    }

    list.innerHTML = html;
}

function openChat(index) {
    send({ type: 'open_chat', index });
    clearMessages();
}

// ========== 发送消息 ==========

function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.innerText.trim();
    if (!text) return;

    input.textContent = '';
    addUserMessage(text);
    send({ type: 'send_message', text });
}

// ========== 事件绑定 ==========

document.addEventListener('DOMContentLoaded', () => {
    connectWS();

    // 发送按钮
    document.getElementById('btn-send').addEventListener('click', sendMessage);

    // 输入框 Enter
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // 重连
    document.getElementById('btn-reconnect').addEventListener('click', () => {
        send({ type: 'reconnect' });
        showToast('🔄 正在重连...');
    });

    // 新建对话
    document.getElementById('btn-new-chat').addEventListener('click', () => {
        send({ type: 'new_chat' });
    });

    // 刷新对话列表
    document.getElementById('btn-refresh-chats').addEventListener('click', () => {
        send({ type: 'get_chats' });
        showToast('🔄 正在加载...');
    });

    // 截屏
    document.getElementById('btn-screenshot').addEventListener('click', () => {
        send({ type: 'screenshot' });
        showToast('📸 正在截屏...');
    });

    // 关闭截屏弹窗
    document.getElementById('btn-close-screenshot').addEventListener('click', () => {
        document.getElementById('screenshot-modal').style.display = 'none';
    });
    document.getElementById('screenshot-modal').addEventListener('click', (e) => {
        if (e.target.id === 'screenshot-modal') {
            document.getElementById('screenshot-modal').style.display = 'none';
        }
    });

    // 移动端侧边栏
    document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
    });

    // 点击消息区域关闭侧边栏
    document.getElementById('main-area').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
    });

    // 聚焦输入框
    document.getElementById('chat-input').focus();
});
