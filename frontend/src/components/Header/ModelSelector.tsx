/**
 * ModelSelector — 模型选择下拉
 *
 * 从 store.models 动态获取可用模型列表
 * position='header' 时向下弹出，position='input' 时向上弹出（默认）
 */
import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/store';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface ModelSelectorProps {
    position?: 'header' | 'input';
}

export function ModelSelector({ position = 'input' }: ModelSelectorProps) {
    const [open, setOpen] = useState(false);
    const currentModel = useAppStore(s => s.config.model);
    const models = useAppStore(s => s.models);
    const setConfig = useAppStore(s => s.setConfig);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const isHeader = position === 'header';
    const Chevron = isHeader ? ChevronDown : ChevronUp;

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const currentModelInfo = models.find(m => m.model === currentModel);
    const displayName = currentModelInfo?.label || currentModel;

    const handleSelect = (model: string) => {
        setConfig({ model });
        setOpen(false);
    };

    const menuClassName = [
        'input-dropdown-menu',
        'model-menu',
        isHeader && 'header-dropdown-menu',
    ].filter(Boolean).join(' ');

    return (
        <div className={`input-dropdown ${isHeader ? 'header-model-selector' : ''}`} ref={dropdownRef}>
            <button
                className={`input-dropdown-trigger ${isHeader ? 'header-model-trigger' : ''}`}
                onClick={() => setOpen(!open)}
                id="model-selector"
            >
                <Chevron size={14} className={`dropdown-chevron-up ${open ? 'open' : ''}`} />
                <span>{displayName}</span>
            </button>

            {open && (
                <div className={menuClassName}>
                    <div className="dropdown-menu-title">Model</div>

                    {models.length > 0 ? (
                        models.map(m => (
                            <button
                                key={m.model}
                                className={`dropdown-option ${m.model === currentModel ? 'active' : ''}`}
                                onClick={() => handleSelect(m.model)}
                            >
                                <div className="dropdown-option-name">
                                    {m.label}
                                    {m.tag && <span className="model-tag">{m.tag}</span>}
                                </div>
                                {m.quota !== undefined && m.quota < 1 && (
                                    <div className="model-quota">
                                        <div
                                            className="model-quota-bar"
                                            style={{ width: `${Math.round(m.quota * 100)}%` }}
                                        />
                                    </div>
                                )}
                            </button>
                        ))
                    ) : (
                        <div className="dropdown-empty">LS 未连接，无法获取模型列表</div>
                    )}
                </div>
            )}
        </div>
    );
}
