/**
 * KnowledgeArtifactsStep — 知识引用渲染 (Debug 模式)
 *
 * 渲染 AI 参考的知识库条目列表。
 * normalizer 已将 <knowledge_item> 块解析为结构化 items 数组。
 */
import { useState } from 'react';
import type { Step, KnowledgeItem } from '@/types';

interface Props {
    step: Step;
}

export function KnowledgeArtifactsStep({ step }: Props) {
    const [expanded, setExpanded] = useState(false);
    const items = step.knowledgeArtifacts?.items;
    const content = step.knowledgeArtifacts?.content;

    if (!items?.length && !content) return null;

    const count = items?.length ?? 0;

    return (
        <div className={`thinking-block variant-knowledge ${expanded ? 'expanded' : ''}`}>
            <button
                className="thinking-toggle"
                onClick={() => setExpanded(!expanded)}
            >
                <span className="thinking-chevron">{expanded ? '\u25BC' : '\u25B6'}</span>
                <span>
                    {count > 0
                        ? `\u5F15\u7528 ${count} \u6761\u77E5\u8BC6`
                        : '\u77E5\u8BC6\u5F15\u7528'}
                </span>
            </button>
            {expanded && (
                <div className="thinking-content">
                    {items && items.length > 0 ? (
                        <div className="ki-list">
                            {items.map((item, i) => (
                                <KnowledgeItemCard key={i} item={item} />
                            ))}
                        </div>
                    ) : (
                        <pre style={{
                            margin: 0,
                            padding: '12px',
                            background: 'rgba(0,0,0,0.3)',
                            borderRadius: '6px',
                            fontSize: '12px',
                            color: '#34d399',
                            whiteSpace: 'pre-wrap',
                        }}>
                            {content}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
}

// ========== KI 单项卡片 ==========

function KnowledgeItemCard({ item }: { item: KnowledgeItem }) {
    const [open, setOpen] = useState(false);

    return (
        <div className="ki-card">
            <button className="ki-card-header" onClick={() => setOpen(!open)}>
                <span className="ki-card-chevron">{open ? '\u25BC' : '\u25B6'}</span>
                <span className="ki-card-title">{item.title}</span>
                {item.artifactPaths.length > 0 && (
                    <span className="ki-card-count">{item.artifactPaths.length} files</span>
                )}
            </button>
            {open && (
                <div className="ki-card-body">
                    {item.summary && (
                        <p className="ki-card-summary">{item.summary}</p>
                    )}
                    {item.lastAccessed && (
                        <div className="ki-card-meta">
                            Last accessed: {item.lastAccessed}
                        </div>
                    )}
                    {item.artifactPaths.length > 0 && (
                        <div className="ki-card-paths">
                            {item.artifactPaths.map((p, i) => (
                                <code key={i} className="ki-card-path">{p}</code>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
