/**
 * InputBox — 消息输入框
 */
import { useState, useCallback, useRef, type KeyboardEvent } from 'react';
import { useAppStore } from '@/store';

export function InputBox() {
    const [text, setText] = useState('');
    const sendMessage = useAppStore(s => s.sendMessage);
    const conversationStatus = useAppStore(s => s.conversationStatus);
    const activeConversationId = useAppStore(s => s.activeConversationId);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const isRunning = conversationStatus === 'RUNNING';
    const canSend = text.trim().length > 0 && !isRunning && !!activeConversationId;

    const handleSend = useCallback(() => {
        if (!canSend) return;
        const msg = text.trim();
        setText('');
        sendMessage(msg);
        inputRef.current?.focus();
    }, [canSend, text, sendMessage]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

    return (
        <div className="input-box">
            <div className="input-box-inner">
                <textarea
                    ref={inputRef}
                    className="input-textarea"
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                        !activeConversationId
                            ? '请先选择或创建对话'
                            : isRunning
                                ? 'AI 正在回复...'
                                : '输入消息... (Enter 发送, Shift+Enter 换行)'
                    }
                    disabled={!activeConversationId}
                    rows={1}
                />
                <button
                    className="input-send-btn"
                    onClick={handleSend}
                    disabled={!canSend}
                    title="发送"
                >
                    发送
                </button>
            </div>
        </div>
    );
}
