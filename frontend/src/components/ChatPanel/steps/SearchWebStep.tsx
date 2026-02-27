/**
 * SearchWebStep — 网页搜索
 */
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function SearchWebStep({ step }: Props) {
    const sw = step.searchWeb;
    if (!sw) return null;

    return (
        <div className="step step-search-web">
            <div className="step-label">🔍 搜索: {sw.query ?? ''}</div>
            {sw.results && sw.results.length > 0 && (
                <ul className="step-search-results">
                    {sw.results.map((r, i) => (
                        <li key={i}>
                            <a href={r.url} target="_blank" rel="noopener noreferrer">
                                {r.title}
                            </a>
                            {r.snippet && <p className="search-snippet">{r.snippet}</p>}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
