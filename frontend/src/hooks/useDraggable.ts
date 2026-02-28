/**
 * useDraggable — 输入框拖拽 + 底部吸附 hook
 *
 * 状态机:
 *   snapped (底部吸附，完整形态)
 *     ─ pointerdown on grip ─→ dragging
 *   dragging (拖拽中，紧凑形态，跟随指针)
 *     ─ pointerup 在吸附区内 ─→ animatingSnap
 *     ─ pointerup 在吸附区外 ─→ floating
 *   floating (停留在拖拽位置，紧凑形态)
 *     ─ pointerdown on grip ─→ dragging
 *     ─ doubleclick ─→ animatingSnap
 *   animatingSnap (回弹动画中)
 *     ─ transitionend ─→ snapped
 */
import { useState, useCallback, useRef, useEffect } from 'react';

interface Position {
    x: number;
    y: number;
}

/** 距视口底部多少 px 内松手触发吸附 */
const SNAP_THRESHOLD = 120;
/** 紧凑形态尺寸 */
const COMPACT_W = 60;
const COMPACT_H = 72;

export function useDraggable() {
    const [isDragging, setIsDragging] = useState(false);
    const [isSnapped, setIsSnapped] = useState(true);
    const [isAnimatingSnap, setIsAnimatingSnap] = useState(false);
    const [position, setPosition] = useState<Position>({ x: 0, y: 0 });

    const containerRef = useRef<HTMLDivElement>(null);
    const offsetRef = useRef<Position>({ x: 0, y: 0 });
    const activeRef = useRef(false);

    // ── 全局 pointermove / pointerup ──
    // 注册在 document 上，避免指针移出元素后丢失事件
    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            if (!activeRef.current) return;
            setPosition({
                x: e.clientX - offsetRef.current.x,
                y: e.clientY - offsetRef.current.y,
            });
        };

        const onUp = (e: PointerEvent) => {
            if (!activeRef.current) return;
            activeRef.current = false;
            setIsDragging(false);

            // 判断是否在吸附区域内
            const distFromBottom = window.innerHeight - e.clientY;
            if (distFromBottom < SNAP_THRESHOLD) {
                // 动画移向底部中央，再完成吸附
                setPosition({
                    x: (window.innerWidth - COMPACT_W) / 2,
                    y: window.innerHeight - COMPACT_H - 20,
                });
                setIsAnimatingSnap(true);
            }
            // else: 停留在当前位置 (floating)
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        return () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        };
    }, []);

    // ── grip 按下：开始拖拽 ──
    const handleGripPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // 紧凑矩形以指针为中心偏上（grip 在顶部）
        offsetRef.current = { x: COMPACT_W / 2, y: 12 };
        setPosition({
            x: e.clientX - COMPACT_W / 2,
            y: e.clientY - 12,
        });
        setIsSnapped(false);
        setIsDragging(true);
        setIsAnimatingSnap(false);
        activeRef.current = true;
    }, []);

    // ── 双击回位 ──
    const handleDoubleClick = useCallback(() => {
        setPosition({
            x: (window.innerWidth - COMPACT_W) / 2,
            y: window.innerHeight - COMPACT_H - 20,
        });
        setIsAnimatingSnap(true);
        setIsDragging(false);
        activeRef.current = false;
    }, []);

    // ── 吸附动画结束 ──
    const handleSnapAnimationEnd = useCallback((e: React.TransitionEvent) => {
        // left 和 top 都会触发 transitionend，只处理一次
        if (e.propertyName !== 'left') return;
        setIsSnapped(true);
        setIsAnimatingSnap(false);
        setPosition({ x: 0, y: 0 });
    }, []);

    return {
        isDragging,
        isSnapped,
        isAnimatingSnap,
        isCompact: !isSnapped,
        position,
        handleGripPointerDown,
        handleDoubleClick,
        handleSnapAnimationEnd,
        containerRef,
    };
}
