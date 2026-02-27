/**
 * InputBox — 消息输入框
 */
import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from 'react';
import { useAppStore } from '@/store';
import { Mic, ArrowRight, Plus } from 'lucide-react';
import { ConfigPanel } from '../ConfigPanel/ConfigPanel';
import { ModeSelector } from '../Header/ModeSelector';
import { ModelSelector } from '../Header/ModelSelector';

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
            <div className="input-box-inner-vertical">
                {/* 文本输入区 */}
                <textarea
                    ref={inputRef}
                    className="input-textarea-vertical"
                    value={text}
                    onInput={handleInput}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                        !activeConversationId
                            ? '请先选择或创建对话'
                            : isRunning
                                ? 'AI 正在回复...'
                                : 'Ask anything, @ to mention, / for workflows'
                    }
                    disabled={!activeConversationId}
                    rows={1}
                />

                {/* 底部功能区 */}
                <div className="input-bottom-bar">
                    <div className="input-actions-left-bottom">
                        <button
                            className="input-circle-btn ghost"
                            onClick={() => setShowConfigOptions(!showConfigOptions)}
                            title="配置"
                        >
                            <Plus size={16} />
                        </button>

                        <div className="input-selectors">
                            <ModeSelector />
                            <ModelSelector />
                        </div>

                        {showConfigOptions && (
                            <div className="input-config-popover" data-testid="config-popover">
                                <ConfigPanel />
                            </div>
                        )}
                    </div>

                    <div className="input-actions-right-bottom">
                        <button className="input-circle-btn ghost" title="语音">
                            <Mic size={16} />
                        </button>

                        <button
                            className={`input-circle-btn solid ${canSend ? 'active' : ''}`}
                            onClick={handleSend}
                            disabled={!canSend}
                            title="发送"
                        >
                            <ArrowRight size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
