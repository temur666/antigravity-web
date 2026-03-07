/**
 * StickyBubble — 阅读模式下的顶部粘性问题气泡
 *
 * 使用 IntersectionObserver 监听所有用户消息 DOM 节点，
 * 当某条用户消息离开视口顶部时，气泡内容自动更新为该消息。
 */
import './StickyBubble.css';
import { useEffect, useState, useRef, useCallback } from 'react';
import type { Step } from '@/types';
import { getUserInputText } from '@/types';

interface Props {
    steps: Step[];
    scrollContainer: HTMLElement | null;
    visible: boolean;
}

interface UserTurn {
    index: number; // step 在 steps 数组中的索引
    text: string;
}

export function StickyBubble({ steps, scrollContainer, visible }: Props) {
    const [currentText, setCurrentText] = useState('');
    const [fading, setFading] = useState(false);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const lastTextRef = useRef('');

    // 提取所有用户输入 turn
    const userTurns: UserTurn[] = steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => step.type === 'CORTEX_STEP_TYPE_USER_INPUT')
        .map(({ step, index }) => ({
            index,
            text: getUserInputText(step),
        }));

    // 更新文字（带淡入淡出）
    const updateText = useCallback((newText: string) => {
        if (newText === lastTextRef.current) return;
        lastTextRef.current = newText;
        setFading(true);
        setTimeout(() => {
            setCurrentText(newText);
            setFading(false);
        }, 100);
    }, []);

    useEffect(() => {
        if (!visible || !scrollContainer || userTurns.length === 0) {
            return;
        }

        // 找到所有用户消息的 DOM 元素
        const stepElements = scrollContainer.querySelectorAll<HTMLElement>(
            '.step-wrapper[data-step-type="CORTEX_STEP_TYPE_USER_INPUT"]'
        );

        if (stepElements.length === 0) return;

        // 初始化：显示第一条用户消息
        if (!lastTextRef.current && userTurns.length > 0) {
            updateText(userTurns[0].text);
        }

        // IntersectionObserver：当用户消息通过视口顶部时触发
        observerRef.current = new IntersectionObserver(
            (entries) => {
                // 找到最后一个不在视口内（已滚过顶部）的用户消息
                let latestPassedIndex = -1;

                entries.forEach((entry) => {
                    if (!entry.isIntersecting) {
                        const el = entry.target as HTMLElement;
                        const stepIndex = parseInt(el.dataset.stepIndex || '-1', 10);
                        // 只关心向上滚出视口的（boundingClientRect.bottom < rootBounds.top）
                        if (entry.boundingClientRect.bottom < (entry.rootBounds?.top ?? 0)) {
                            if (stepIndex > latestPassedIndex) {
                                latestPassedIndex = stepIndex;
                            }
                        }
                    }
                });

                if (latestPassedIndex >= 0) {
                    const turn = userTurns.find(t => t.index === latestPassedIndex);
                    if (turn) {
                        updateText(turn.text);
                    }
                }
            },
            {
                root: scrollContainer,
                threshold: 0,
                rootMargin: '0px 0px -90% 0px', // 只关心顶部 10% 区域
            }
        );

        stepElements.forEach((el) => {
            observerRef.current!.observe(el);
        });

        return () => {
            observerRef.current?.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, scrollContainer, steps.length, updateText]);

    // 不可见时或没有用户消息时不渲染
    if (userTurns.length === 0) return null;

    return (
        <div className={`sticky-bubble ${visible ? 'visible' : ''}`}>
            <span className={`sticky-bubble-text ${fading ? 'fading' : ''}`}>
                {currentText || userTurns[0]?.text || ''}
            </span>
        </div>
    );
}
