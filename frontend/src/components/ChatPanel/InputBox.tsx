/**
 * InputBox — 消息输入框（支持拖拽移动 + 底部吸附）
 *
 * 默认吸附在底部，显示完整输入框。
 * 通过顶部 grip bar 拖拽后变为 280px 宽的窄面板，仍可完整交互。
 * 底部功能栏在宽度不足时自动切换为双行布局（CSS Container Query）。
 * 松手在底部 120px 内或双击 grip bar 可吸附回底部。
 */
import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from 'react';
import { useAppStore } from '@/store';
import { Mic, ArrowRight, Paperclip, X } from 'lucide-react';


import { useDraggable } from '@/hooks/useDraggable';

export function InputBox() {
    const [text, setText] = useState('');
    const [attachments, setAttachments] = useState<{ file: File, previewUrl: string }[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);

    const sendMessage = useAppStore(s => s.sendMessage);
    const conversationStatus = useAppStore(s => s.conversationStatus);
    const activeConversationId = useAppStore(s => s.activeConversationId);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const {
        isDragging,
        isSnapped,
        isAnimatingSnap,
        isFloating,
        position,
        handleGripPointerDown,
        handleDoubleClick,
        handleSnapAnimationEnd,
        containerRef,
    } = useDraggable();

    const isRunning = conversationStatus === 'RUNNING';
    const canSend = (text.trim().length > 0 || attachments.length > 0) && !isRunning && !!activeConversationId && !isUploading;

    const handleSend = useCallback(async () => {
        if (!canSend) return;

        setIsUploading(true);
        const mediaDetails: { uri: string, mimeType: string }[] = [];

        try {
            // Upload all attachments
            for (const att of attachments) {
                const formData = new FormData();
                formData.append('file', att.file);

                const res = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!res.ok) {
                    throw new Error(`Upload failed: ${res.statusText}`);
                }

                const data = await res.json();
                mediaDetails.push({
                    uri: data.uri,
                    mimeType: data.mimeType
                });
            }

            const msg = text.trim();
            setText('');
            setAttachments([]);
            if (inputRef.current) {
                inputRef.current.style.height = 'auto';
            }

            // Send message with media if any
            sendMessage(msg, undefined, mediaDetails.length > 0 ? { media: mediaDetails } : undefined);

            // Revoke object URLs to prevent memory leaks
            attachments.forEach(att => URL.revokeObjectURL(att.previewUrl));
        } catch (err) {
            console.error('Failed to send message:', err);
            // Ideally we'd show a toast here, but we'll minimally reset state for now
        } finally {
            setIsUploading(false);
            inputRef.current?.focus();
        }
    }, [canSend, text, attachments, sendMessage]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        // 移动端 Enter = 换行，桌面端 Enter = 发送（Shift+Enter = 换行）
        const isMobile = window.innerWidth <= 768;
        if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
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


    // ── File Handling ──
    const handleFiles = useCallback((files: FileList | File[]) => {
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return;

        setAttachments(prev => [
            ...prev,
            ...imageFiles.map(file => ({
                file,
                previewUrl: URL.createObjectURL(file)
            }))
        ]);
    }, []);

    const handleRemoveAttachment = useCallback((index: number) => {
        setAttachments(prev => {
            const next = [...prev];
            URL.revokeObjectURL(next[index].previewUrl);
            next.splice(index, 1);
            return next;
        });
    }, []);

    const handlePaste = useCallback((e: React.ClipboardEvent) => {
        if (e.clipboardData.files.length > 0) {
            handleFiles(e.clipboardData.files);
            // Don't prevent default, allow pasting text still
        }
    }, [handleFiles]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.types.includes('Files')) {
            setIsDragOver(true);
        }
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    }, [handleFiles]);

    // Clean up previews on unmount
    useEffect(() => {
        return () => {
            attachments.forEach(att => URL.revokeObjectURL(att.previewUrl));
        };
    }, [attachments]);

    useEffect(() => {
        if (text === '' && inputRef.current) {
            inputRef.current.style.height = 'auto';
        }
    }, [text]);

    // 吸附回底部后自动聚焦输入框
    useEffect(() => {
        if (isSnapped && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isSnapped]);

    // ── className 组合 ──
    const boxClassName = [
        'input-box',
        isFloating && 'input-box-floating',
        isDragging && 'input-box-dragging',
        isAnimatingSnap && 'input-box-animating',
        isDragOver && 'input-box-drag-over',
    ].filter(Boolean).join(' ');

    // ── 浮动定位（仅脱离吸附时生效） ──
    const boxStyle: React.CSSProperties = isFloating
        ? {
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
            bottom: 'auto',
            right: 'auto',
            width: '280px',
        }
        : {};

    return (
        <div
            ref={containerRef}
            className={boxClassName}
            style={boxStyle}
            onTransitionEnd={isAnimatingSnap ? handleSnapAnimationEnd : undefined}
        >
            {/* 拖拽手柄 */}
            <div
                className="input-box-grip"
                onPointerDown={handleGripPointerDown}
                onDoubleClick={isFloating ? handleDoubleClick : undefined}
            >
                <div className="input-box-grip-bar" />
            </div>

            {/* 输入框主体：变为左右水平布局（单行） */}
            <div
                className="input-box-inner-row"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {/* 隐藏的文件输入 */}
                <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    multiple
                    style={{ position: 'absolute', width: 0, height: 0, opacity: 0, overflow: 'hidden', pointerEvents: 'none' }}
                    onChange={e => {
                        if (e.target.files && e.target.files.length > 0) {
                            handleFiles(e.target.files);
                        }
                        if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                />

                {/* 左侧区域：例如附件 */}
                <div className="input-actions-left">
                    <button
                        className="input-circle-btn ghost btn-attach"
                        onClick={() => {
                            console.log('[InputBox] Paperclip clicked, fileInputRef:', fileInputRef.current);
                            fileInputRef.current?.click();
                        }}
                        title="上传附件"
                        disabled={isUploading}
                    >
                        <Paperclip size={16} />
                    </button>
                </div>

                {/* 中间区域：附件预览 + 文本输入框 */}
                <div className="input-content-area">
                    {/* 附件缩略图预览区 */}
                    {attachments.length > 0 && (
                        <div className="input-attachments-preview">
                            {attachments.map((att, idx) => (
                                <div key={Math.random()} className="input-attachment-item">
                                    <img src={att.previewUrl} alt="attachment" />
                                    <button
                                        className="input-attachment-remove"
                                        onClick={() => handleRemoveAttachment(idx)}
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <textarea
                        ref={inputRef}
                        className="input-textarea-row"
                        value={text}
                        onInput={handleInput}
                        onChange={e => setText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        placeholder={
                            !activeConversationId
                                ? '请先选择或创建对话'
                                : isRunning
                                    ? 'AI 正在回复...'
                                    : 'Ask anything...'
                        }
                        disabled={!activeConversationId || isUploading}
                        rows={1}
                    />
                </div>

                {/* 右侧区域：例如麦克风、发送按钮 */}
                <div className="input-actions-right">
                    <button className="input-circle-btn ghost btn-mic" title="语音">
                        <Mic size={16} />
                    </button>

                    <button
                        className={`input-circle-btn solid btn-send ${canSend ? 'active' : ''}`}
                        onClick={handleSend}
                        disabled={!canSend}
                        title="发送"
                    >
                        <ArrowRight size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
