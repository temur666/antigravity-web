/**
 * TurnNav — 阅读模式右侧导航
 *
 * 桌面端：右侧边缘圆点导航，hover 显示 tooltip，点击跳转
 * 移动端：右上角浮动按钮 → 弹出列表 Modal，点击跳转
 *
 * 使用 IntersectionObserver 追踪当前阅读位置。
 */
import './TurnNav.css';
import { useEffect, useState, useRef, useCallback } from 'react';
import { List } from 'lucide-react';
import type { Step } from '@/types';
import { getUserInputText } from '@/types';

interface Props {
    steps: Step[];
    scrollContainer: HTMLElement | null;
    visible: boolean;
    isMobile: boolean;
}

interface UserTurn {
    stepIndex: number;
    turnNumber: number; // 1-based
    text: string;
}

export function TurnNav({ steps, scrollContainer, visible, isMobile }: Props) {
    const [activeTurnIndex, setActiveTurnIndex] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [entering, setEntering] = useState(false);
    const observerRef = useRef<IntersectionObserver | null>(null);

    // 提取所有用户输入
    const userTurns: UserTurn[] = steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => step.type === 'CORTEX_STEP_TYPE_USER_INPUT')
        .map(({ step, index }, turnIdx) => ({
            stepIndex: index,
            turnNumber: turnIdx + 1,
            text: getUserInputText(step),
        }));

    // stagger 动画
    useEffect(() => {
        if (visible) {
            setEntering(true);
            const timer = setTimeout(() => setEntering(false), 600);
            return () => clearTimeout(timer);
        }
    }, [visible]);

    // IntersectionObserver 追踪当前位置
    useEffect(() => {
        if (!visible || !scrollContainer || userTurns.length === 0) return;

        const stepElements = scrollContainer.querySelectorAll<HTMLElement>(
            '.step-wrapper[data-step-type="CORTEX_STEP_TYPE_USER_INPUT"]'
        );
        if (stepElements.length === 0) return;

        // 记录哪些用户消息已经滚过视口顶部
        const passedSet = new Set<number>();

        observerRef.current = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    const el = entry.target as HTMLElement;
                    const stepIndex = parseInt(el.dataset.stepIndex || '-1', 10);

                    if (!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)) {
                        passedSet.add(stepIndex);
                    } else if (entry.isIntersecting) {
                        passedSet.delete(stepIndex);
                    }
                });

                // 当前活跃 = 最后一个已通过的，或第一个
                if (passedSet.size === 0) {
                    setActiveTurnIndex(0);
                } else {
                    const maxPassed = Math.max(...passedSet);
                    const turnIdx = userTurns.findIndex(t => t.stepIndex === maxPassed);
                    if (turnIdx >= 0) {
                        setActiveTurnIndex(turnIdx);
                    }
                }
            },
            {
                root: scrollContainer,
                threshold: 0,
            }
        );

        stepElements.forEach((el) => {
            observerRef.current!.observe(el);
        });

        return () => {
            observerRef.current?.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, scrollContainer, steps.length]);

    // 跳转到指定位置
    const scrollToTurn = useCallback((stepIndex: number) => {
        if (!scrollContainer) return;
        const el = scrollContainer.querySelector<HTMLElement>(
            `.step-wrapper[data-step-index="${stepIndex}"]`
        );
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        setShowModal(false);
    }, [scrollContainer]);

    if (userTurns.length === 0) return null;

    // --- 桌面端：圆点导航 ---
    if (!isMobile) {
        return (
            <div className={`turn-nav-dots ${visible ? 'visible' : ''}`}>
                {userTurns.map((turn, idx) => (
                    <button
                        key={turn.stepIndex}
                        className={`turn-nav-dot ${idx === activeTurnIndex ? 'active' : ''} ${entering ? 'entering' : ''}`}
                        style={entering ? { animationDelay: `${idx * 50}ms` } : undefined}
                        onClick={() => scrollToTurn(turn.stepIndex)}
                        title={turn.text}
                    >
                        <span className="turn-nav-tooltip">{turn.text}</span>
                    </button>
                ))}
            </div>
        );
    }

    // --- 移动端：浮动按钮 + Modal ---
    return (
        <>
            <button
                className={`turn-nav-mobile-btn ${visible ? 'visible' : ''}`}
                onClick={() => setShowModal(true)}
                aria-label="对话导航"
            >
                <List size={18} />
            </button>

            {showModal && (
                <>
                    <div
                        className={`turn-list-modal-backdrop ${showModal ? 'visible' : ''}`}
                        onClick={() => setShowModal(false)}
                    />
                    <div className={`turn-list-modal ${showModal ? 'visible' : ''}`}>
                        <div className="turn-list-title">对话目录</div>
                        {userTurns.map((turn, idx) => (
                            <button
                                key={turn.stepIndex}
                                className={`turn-list-item ${idx === activeTurnIndex ? 'active' : ''}`}
                                onClick={() => scrollToTurn(turn.stepIndex)}
                            >
                                <span className="turn-list-item-index">{turn.turnNumber}</span>
                                <span className="turn-list-item-text">{turn.text}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </>
    );
}
