/**
 * InputBox — 消息输入框
 */
import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from 'react';
import { useAppStore } from '@/store';
import { Settings, Mic, ArrowRight } from 'lucide-react';
import { ConfigPanel } from '../ConfigPanel/ConfigPanel';

export function InputBox() {
    const [text, setText] = useState('');
    const [showConfigOptions, setShowConfigOptions] = useState(false);
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
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
        }
        sendMessage(msg);
        inputRef.current?.focus();
    }, [canSend, text, sendMessage]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

    const handleInput = useCallback(() => {
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
        }
    }, []);

    useEffect(() => {
        if (text === '' && inputRef.current) {
            inputRef.current.style.height = 'auto';
        }
    }, [text]);

    return (
        <div className="input-box">
            <div className="input-box-inner">
                <div className="input-actions-left">
                    <button
                        className="input-action-btn"
                        onClick={() => setShowConfigOptions(!showConfigOptions)}
                        title="配置"
                    >
                        <Settings size={20} />
                    </button>
                    <button className="input-action-btn" title="语音">
                        <Mic size={20} />
                    </button>
                    {showConfigOptions && (
                        <div className="input-config-popover" data-testid="config-popover">
                            <ConfigPanel />
                        </div>
                    )}
                </div>

                <textarea
                    ref={inputRef}
                    className="input-textarea"
                    value={text}
                    onInput={handleInput}
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
                    className={`input-send-btn ${canSend ? 'active' : ''}`}
                    onClick={handleSend}
                    disabled={!canSend}
                    title="发送"
                >
                    <ArrowRight size={20} />
                </button>
            </div>
        </div>
    );
}
