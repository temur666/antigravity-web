/**
 * ModeSelector — Fast / Planning 模式切换下拉
 *
 * agenticMode: true  = Planning (Agentic, 先规划后执行)
 * agenticMode: false = Fast (直接执行)
 */
import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/store';
import { ChevronDown } from 'lucide-react';

export function ModeSelector() {
    const [open, setOpen] = useState(false);
    const agenticMode = useAppStore(s => s.config.agenticMode);
    const setConfig = useAppStore(s => s.setConfig);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const currentMode = agenticMode ? 'Planning' : 'Fast';

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (isAgentic: boolean) => {
        setConfig({ agenticMode: isAgentic });
        setOpen(false);
    };

    return (
        <div className="header-dropdown" ref={dropdownRef}>
            <button
                className="header-dropdown-trigger"
                onClick={() => setOpen(!open)}
                id="mode-selector"
            >
                <ChevronDown size={14} className={`dropdown-chevron ${open ? 'open' : ''}`} />
                <span>{currentMode}</span>
            </button>

            {open && (
                <div className="header-dropdown-menu">
                    <div className="dropdown-menu-title">Conversation mode</div>

                    <button
                        className={`dropdown-option ${agenticMode ? 'active' : ''}`}
                        onClick={() => handleSelect(true)}
                    >
                        <div className="dropdown-option-name">Planning</div>
                        <div className="dropdown-option-desc">
                            先规划后执行。适合深度研究、复杂任务或协作式工作
                        </div>
                    </button>

                    <button
                        className={`dropdown-option ${!agenticMode ? 'active' : ''}`}
                        onClick={() => handleSelect(false)}
                    >
                        <div className="dropdown-option-name">Fast</div>
                        <div className="dropdown-option-desc">
                            直接执行。适合简单、快速完成的任务
                        </div>
                    </button>
                </div>
            )}
        </div>
    );
}
