/**
 * ConfigPanel — 配置面板
 *
 * 暴露所有配置项，支持动态 model 列表
 */
import { useEffect, useCallback } from 'react';
import { useAppStore } from '@/store';
import { CONFIG_META } from '@/types';
import type { CascadeConfig } from '@/types';

export function ConfigPanel() {
    const config = useAppStore(s => s.config);
    const models = useAppStore(s => s.models);
    const setConfig = useAppStore(s => s.setConfig);
    const loadConfig = useAppStore(s => s.loadConfig);

    useEffect(() => {
        loadConfig();
    }, [loadConfig]);

    const handleChange = useCallback(
        (key: keyof CascadeConfig, value: string | boolean) => {
            setConfig({ [key]: value } as Partial<CascadeConfig>);
        },
        [setConfig],
    );

    return (
        <div className="config-panel">
            <div className="config-panel-title">⚙️ 配置</div>

            {(Object.keys(CONFIG_META) as Array<keyof CascadeConfig>).map(key => {
                const meta = CONFIG_META[key];
                const currentValue = config[key];

                return (
                    <div className="config-item" key={key}>
                        <div className="config-item-header">
                            <label className="config-item-label">{meta.label}</label>
                            <div className="config-item-desc">{meta.description}</div>
                        </div>

                        {meta.inputType === 'toggle' && (
                            <button
                                className={`config-toggle ${currentValue ? 'on' : 'off'}`}
                                onClick={() => handleChange(key, !currentValue)}
                            >
                                {currentValue ? 'ON' : 'OFF'}
                            </button>
                        )}

                        {meta.inputType === 'select' && (
                            <select
                                className="config-select"
                                value={String(currentValue)}
                                onChange={e => handleChange(key, e.target.value)}
                            >
                                {/* model 特殊处理：options 从 models 动态生成 */}
                                {key === 'model'
                                    ? (models.length > 0
                                        ? models.map(m => (
                                            <option key={m.model} value={m.model}>
                                                {m.label}{m.tag ? ` [${m.tag}]` : ''}
                                            </option>
                                        ))
                                        : <option value={config.model}>{config.model}</option>
                                    )
                                    : meta.options?.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))
                                }
                            </select>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
