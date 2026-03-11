/**
 * InputBox — 消息输入框（支持拖拽移动 + 底部吸附）
 *
 * 默认吸附在底部，显示完整输入框。
 * 通过顶部 grip bar 拖拽后变为 280px 宽的窄面板，仍可完整交互。
 * 底部功能栏在宽度不足时自动切换为双行布局（CSS Container Query）。
 * 松手在底部 120px 内或双击 grip bar 可吸附回底部。
 */
import './InputBox.css';
import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from 'react';
import { useAppStore } from '@/store';
import { Mic, ArrowRight, Square, Paperclip, X, MessagesSquare, Plus } from 'lucide-react';
import { truncate } from '@/utils/format';

import { useDraggable } from '@/hooks/useDraggable';

const MAX_BASE64_SIZE = 800_000; // ~600KB raw
const MAX_DIMENSION = 1024;

/**
 * Compress image using Canvas: resize to maxDim and encode as JPEG.
 * Small images pass through without compression.
 */
async function compressImage(
    file: File, maxDim = MAX_DIMENSION, quality = 0.8
): Promise<{ data: string; mimeType: string }> {
    // Read as data URL first
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });

    const rawBase64 = dataUrl.split(',')[1] || '';

    // If small enough, use as-is
    if (rawBase64.length <= MAX_BASE64_SIZE) {
        return { data: rawBase64, mimeType: file.type || 'image/png' };
    }

    // Load into Image for resizing
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Failed to load image'));
        el.src = dataUrl;
    });

    // Calculate target dimensions
    let w = img.width, h = img.height;
    if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
    }

    // Draw to canvas and export as JPEG
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
    const compressedBase64 = compressedDataUrl.split(',')[1] || '';

    console.log(`[compressImage] ${file.name}: ${rawBase64.length} -> ${compressedBase64.length} chars (${w}x${h})`);

    return { data: compressedBase64, mimeType: 'image/jpeg' };
}

export function InputBox() {
    const activeConversationId = useAppStore(s => s.activeConversationId);
    const draftMap = useAppStore(s => s.draftMap);
    const setDraft = useAppStore(s => s.setDraft);

    // 单一数据源：直接从 store 派生，不维护 local state
    const text = activeConversationId ? (draftMap[activeConversationId] ?? '') : '';
    const [attachments, setAttachments] = useState<{ file: File, previewUrl: string }[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);

    const sendMessage = useAppStore(s => s.sendMessage);
    const conversationStatus = useAppStore(s => s.conversationStatus);
    const cancelConversation = useAppStore(s => s.cancelConversation);
    const conversations = useAppStore(s => s.conversations);
    const selectConversation = useAppStore(s => s.selectConversation);
    const newChat = useAppStore(s => s.newChat);
    const [showTags, setShowTags] = useState(false);
    const recentConversations = conversations.slice(0, 5);
    const hasText = text.trim().length > 0;
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isSendingRef = useRef(false); // 同步锁，防止重复发送

    // 切换对话时，重新计算 textarea 高度（text 已由 store 驱动，无需同步）
    useEffect(() => {
        if (!inputRef.current) return;
        inputRef.current.style.height = 'auto';
        if (text) {
            requestAnimationFrame(() => {
                if (inputRef.current) {
                    inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
                }
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeConversationId]);

    const {
        isDragging,
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
        if (isSendingRef.current) return; // 防止手机端多点/快速点击重复触发
        isSendingRef.current = true;

        setIsUploading(true);
        const mediaDetails: { data: string, mimeType: string }[] = [];

        try {
            // Read and compress all attachments
            for (const att of attachments) {
                const compressed = await compressImage(att.file, 1024, 0.8);
                mediaDetails.push(compressed);
            }

            // If only images without text, use a default prompt
            let msg = text.trim();
            if (!msg && mediaDetails.length > 0) {
                msg = '请查看这张图片';
            }


            setAttachments([]);
            // 发送成功后清除草稿
            if (activeConversationId) setDraft(activeConversationId, '');
            if (inputRef.current) {
                inputRef.current.style.height = 'auto';
            }

            // Send message with media if any
            await sendMessage(msg, undefined, mediaDetails.length > 0 ? { media: mediaDetails } : undefined);

            // Revoke object URLs to prevent memory leaks
            attachments.forEach(att => URL.revokeObjectURL(att.previewUrl));
        } catch (err) {
            console.error('Failed to send message:', err);
        } finally {
            isSendingRef.current = false;
            setIsUploading(false);
            // 移动端不自动 focus，让键盘自然收起，避免用户手动折叠时触发幽灵 click
            const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
            if (!isMobile) {
                inputRef.current?.focus();
            }
        }
    }, [canSend, text, attachments, sendMessage, activeConversationId, setDraft]);

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

    // ── 移动端：键盘弹出时，通过 visualViewport 推动输入框上移 ──
    useEffect(() => {
        const vv = window.visualViewport;
        if (!vv) return;

        let fullHeight = window.innerHeight;
        const THRESHOLD = 150;

        const update = () => {
            const el = containerRef.current;
            if (!el) return;

            const diff = fullHeight - vv.height;
            if (diff > THRESHOLD) {
                // 键盘弹出：计算视觉视口底部与布局视口底部的偏移
                const offsetBottom = window.innerHeight - (vv.offsetTop + vv.height);
                el.style.transform = `translateY(-${offsetBottom}px)`;
                el.style.paddingBottom = '0'; // 键盘弹出时移除 safe-area padding
            } else {
                // 键盘折叠：先禁用点击，防止 transform 位移产生幽灵 click
                el.style.pointerEvents = 'none';
                el.style.transform = '';
                el.style.paddingBottom = ''; // 恢复 CSS 默认值
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (el) el.style.pointerEvents = '';
                    });
                });
            }
        };

        const onWindowResize = () => {
            // 键盘未弹出时更新全高度基准（处理屏幕旋转等场景）
            if (vv.height >= window.innerHeight - 50) {
                fullHeight = window.innerHeight;
            }
        };

        vv.addEventListener('resize', update);
        vv.addEventListener('scroll', update);
        window.addEventListener('resize', onWindowResize);

        return () => {
            vv.removeEventListener('resize', update);
            vv.removeEventListener('scroll', update);
            window.removeEventListener('resize', onWindowResize);
        };
    }, [containerRef]);

    // Remove auto-focus on snap back to bottom, user specifically requested not to trigger keyboard when changing routes

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

            {/* 对话标签栏 */}
            <div className={`conversation-tags-row${showTags ? ' open' : ''}`}>
                <button
                    className="conv-tag conv-tag-new"
                    onClick={() => newChat()}
                    title="新建对话"
                    style={{ animationDelay: '0ms' }}
                >
                    <Plus size={14} />
                </button>
                {recentConversations.map((conv, idx) => {
                    const isActiveConv = conv.id === activeConversationId;
                    const running = isActiveConv
                        ? conversationStatus === 'RUNNING'
                        : conv.status === 'RUNNING';
                    const title = conv.title
                        ? truncate(conv.title, 12)
                        : conv.id.slice(0, 8);
                    return (
                        <button
                            key={conv.id}
                            className={`conv-tag${isActiveConv ? ' conv-tag-active' : ''}${running ? ' conv-tag-running' : ''}`}
                            onClick={() => selectConversation(conv.id)}
                            style={{ animationDelay: `${(idx + 1) * 50}ms` }}
                        >
                            {running && <span className="conv-tag-dot" />}
                            <span className="conv-tag-label">{title}</span>
                        </button>
                    );
                })}
            </div>

            {/* 切换按钮 + 输入框主体 */}
            <div className="input-row-wrapper">
                <button
                    className={`conv-tags-toggle${hasText ? ' conv-tags-toggle-hidden' : ''}`}
                    onClick={() => setShowTags(prev => !prev)}
                    title="最近对话"
                >
                    <MessagesSquare size={16} />
                </button>

                {/* 输入框主体 */}
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
                    style={{ display: 'none' }}
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
                        onClick={() => fileInputRef.current?.click()}
                        title="上传附件"
                        disabled={!activeConversationId || isUploading}
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
                                <div key={att.previewUrl} className="input-attachment-item">
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
                        onChange={e => {
                            if (activeConversationId) setDraft(activeConversationId, e.target.value);
                        }}
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

                {/* 右侧区域：麦克风、发送/终止按钮 */}
                <div className="input-actions-right">
                    <button className="input-circle-btn ghost btn-mic" title="语音 (即将推出)" disabled>
                        <Mic size={16} />
                    </button>

                    {isRunning ? (
                        <button
                            className="btn-send-stop"
                            onClick={() => cancelConversation()}
                            title="终止"
                        >
                            <Square size={20} strokeWidth={2.5} />
                        </button>
                    ) : (
                        <button
                            className="btn-send-stop"
                            onClick={handleSend}
                            disabled={!canSend}
                            title="发送"
                        >
                            <ArrowRight size={20} strokeWidth={2.5} />
                        </button>
                    )}
                </div>
                </div>
            </div>
        </div>
    );
}
