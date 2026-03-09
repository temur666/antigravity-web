/**
 * FileViewer — 文件查看模态框
 *
 * 通过 /api/file 接口读取服务器端文件内容，
 * Markdown 文件渲染富文本，代码文件用 highlight.js 语法高亮。
 */
import { useState, useEffect, useCallback } from 'react';
import { renderMarkdown } from '@/utils/markdown';
import hljs from 'highlight.js';
import './FileViewer.css';

interface FileViewerProps {
    /** 服务器端的绝对路径 */
    filePath: string;
    onClose: () => void;
}

interface FileData {
    content: string;
    filename: string;
    path: string;
    extension: string;
    size: number;
    mtime: string;
}

/** Markdown 类型扩展名 */
const MD_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

export function FileViewer({ filePath, onClose }: FileViewerProps) {
    const [fileData, setFileData] = useState<FileData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const controller = new AbortController();

        // 将绝对路径作为 path 参数传递
        // 后端会进行 realpath 校验确保安全
        fetch(`/api/file?path=${encodeURIComponent(filePath)}`, { signal: controller.signal })
            .then(async (res) => {
                if (!res.ok) {
                    const body = await res.json().catch(() => ({ error: res.statusText }));
                    throw new Error(body.error || `HTTP ${res.status}`);
                }
                return res.json();
            })
            .then((data: FileData) => {
                setFileData(data);
                setLoading(false);
            })
            .catch((err) => {
                if (controller.signal.aborted) return;
                setError(err.message);
                setLoading(false);
            });

        return () => controller.abort();
    }, [filePath]);

    // 点击遮罩关闭
    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    }, [onClose]);

    // ESC 关闭
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    /** 渲染文件内容：MD 用 renderMarkdown，其他用 highlight.js */
    const renderContent = () => {
        if (!fileData) return null;

        if (MD_EXTENSIONS.has(fileData.extension)) {
            return (
                <div
                    className="file-viewer-markdown ai-response"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(fileData.content) }}
                />
            );
        }

        // 代码文件：尝试语法高亮
        let highlighted: string;
        if (fileData.extension && hljs.getLanguage(fileData.extension)) {
            highlighted = hljs.highlight(fileData.content, { language: fileData.extension }).value;
        } else {
            // 纯文本 fallback
            highlighted = fileData.content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }

        return (
            <div className="file-viewer-code">
                <pre><code className={`hljs language-${fileData.extension}`} dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
            </div>
        );
    };

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <div className="file-viewer-backdrop" onClick={handleBackdropClick}>
            <div className="file-viewer-modal">
                {/* Header */}
                <div className="file-viewer-header">
                    <div className="file-viewer-title">
                        <span className="file-viewer-filename">{fileData?.filename || filePath.split('/').pop()}</span>
                        {fileData && (
                            <span className="file-viewer-meta">
                                {fileData.path} | {formatSize(fileData.size)}
                            </span>
                        )}
                    </div>
                    <button className="file-viewer-close" onClick={onClose} title="关闭 (ESC)">
                        &times;
                    </button>
                </div>

                {/* Body */}
                <div className="file-viewer-body">
                    {loading && <div className="file-viewer-loading">加载中...</div>}
                    {error && <div className="file-viewer-error">加载失败: {error}</div>}
                    {fileData && renderContent()}
                </div>
            </div>
        </div>
    );
}
