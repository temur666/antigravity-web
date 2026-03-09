/**
 * FileBrowser — 移动端文件浏览器页面模块
 */
import { useState, useEffect, useCallback } from 'react';
import { Folder, FileText, ChevronRight, CornerLeftUp } from 'lucide-react';
import { FileViewer } from '../FileViewer/FileViewer';
import './FileBrowser.css';

interface FsItem {
    name: string;
    path: string;
    isDir: boolean;
}

export function FileBrowser() {
    const [currentPath, setCurrentPath] = useState('');
    const [items, setItems] = useState<FsItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 文件查看框
    const [viewingFile, setViewingFile] = useState<string | null>(null);

    const loadDirectory = useCallback(async (dirPath: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/fs/list?path=${encodeURIComponent(dirPath)}`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setItems(data.items);
            setCurrentPath(data.path === '.' ? '' : data.path);
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError(String(err));
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDirectory(currentPath);
    }, [currentPath, loadDirectory]);

    const handleItemClick = (item: FsItem) => {
        if (item.isDir) {
            setCurrentPath(item.path);
        } else {
            setViewingFile(item.path);
        }
    };

    const handleGoUp = () => {
        if (!currentPath) return; // 已经在根目录
        const parts = currentPath.split('/');
        parts.pop();
        setCurrentPath(parts.join('/'));
    };

    // 渲染面包屑
    const renderBreadcrumbs = () => {
        const parts = currentPath ? currentPath.split('/') : [];
        return (
            <div className="file-browser-breadcrumbs">
                <button 
                    className="breadcrumb-item" 
                    onClick={() => setCurrentPath('')}
                >
                    项目
                </button>
                {parts.map((p, i) => {
                    const pathToHere = parts.slice(0, i + 1).join('/');
                    return (
                        <div key={i} className="breadcrumb-segment">
                            <ChevronRight size={14} className="breadcrumb-separator" />
                            <button 
                                className="breadcrumb-item"
                                onClick={() => setCurrentPath(pathToHere)}
                            >
                                {p}
                            </button>
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="file-browser-page">
            <header className="file-browser-header">
                {renderBreadcrumbs()}
            </header>

            <div className="file-browser-content">
                {loading && <div className="file-browser-loading">加载目录...</div>}
                
                {error && (
                    <div className="file-browser-error">
                        {error}
                        <button onClick={() => loadDirectory(currentPath)} className="header-btn" style={{marginLeft: 12}}>重试</button>
                    </div>
                )}

                {!loading && !error && (
                    <div className="file-list">
                        {currentPath !== '' && (
                            <button className="file-item go-up" onClick={handleGoUp}>
                                <CornerLeftUp size={20} className="file-icon" />
                                <span className="file-name">返回上一级</span>
                            </button>
                        )}
                        
                        {items.length === 0 && currentPath !== '' && (
                            <div className="file-browser-empty">文件夹为空</div>
                        )}

                        {items.map(item => (
                            <button 
                                key={item.path} 
                                className="file-item"
                                onClick={() => handleItemClick(item)}
                            >
                                {item.isDir ? (
                                    <Folder size={20} className="file-icon folder" />
                                ) : (
                                    <FileText size={20} className="file-icon doc" />
                                )}
                                <span className="file-name">{item.name}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {viewingFile && (
                <FileViewer 
                    filePath={viewingFile} 
                    onClose={() => setViewingFile(null)} 
                />
            )}
        </div>
    );
}
