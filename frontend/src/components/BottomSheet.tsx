import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface BottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
}

const VELOCITY_THRESHOLD = 0.5; // px/ms
const DISMISS_THRESHOLD = 150; // px
const CLOSE_ANIMATION_MS = 250;

export function BottomSheet({ isOpen, onClose, children }: BottomSheetProps) {
    const [shouldRender, setShouldRender] = useState(isOpen);
    const sheetRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // 回弹相关
    const startYRef = useRef(0);
    const startTRef = useRef(0);
    const currentYRef = useRef(0);
    const isDraggingRef = useRef(false);

    // 开关状态控制
    useEffect(() => {
        if (isOpen) {
            setShouldRender(true);
            // reset translation immediately
            if (sheetRef.current) {
                sheetRef.current.style.transition = '';
                sheetRef.current.style.transform = `translateY(0px)`;
            }
        } else if (shouldRender) {
            // Animate out
            if (sheetRef.current) {
                sheetRef.current.style.transition = `transform ${CLOSE_ANIMATION_MS}ms cubic-bezier(0.25, 0.8, 0.25, 1)`;
                sheetRef.current.style.transform = `translateY(100%)`;
            }
            const timer = setTimeout(() => {
                setShouldRender(false);
            }, CLOSE_ANIMATION_MS);
            return () => clearTimeout(timer);
        }
    }, [isOpen, shouldRender]);

    // Touch 事件逻辑
    const onTouchStart = useCallback((e: TouchEvent) => {
        // 如果是从内容区滚动触发的 touch，并且当前不在顶部，不要拦截它
        if (contentRef.current && contentRef.current.scrollTop > 0) {
            return;
        }
        isDraggingRef.current = true;
        startYRef.current = e.touches[0].clientY;
        startTRef.current = e.timeStamp;
        if (sheetRef.current) {
            sheetRef.current.style.transition = 'none';
        }
    }, []);

    const onTouchMove = useCallback((e: TouchEvent) => {
        if (!isDraggingRef.current) return;
        
        const deltaY = e.touches[0].clientY - startYRef.current;
        // 只能往下拉 (deltaY > 0); 往上拉则提供极强的阻力或者直接不允许
        if (deltaY < 0) {
            currentYRef.current = deltaY * 0.1; // 极强拉伸阻力
        } else {
            currentYRef.current = deltaY;
        }

        if (sheetRef.current) {
            sheetRef.current.style.transform = `translateY(${Math.max(0, currentYRef.current)}px)`;
        }
        
        // 如果正在往下拉，防止触发页面原生滚动
        if (deltaY > 0 && e.cancelable) {
            e.preventDefault();
        }
    }, []);

    const onTouchEnd = useCallback((e: TouchEvent) => {
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;
        
        if (!sheetRef.current) return;
        sheetRef.current.style.transition = `transform ${CLOSE_ANIMATION_MS}ms cubic-bezier(0.25, 0.8, 0.25, 1)`;
        
        const deltaY = currentYRef.current;
        const dt = e.timeStamp - startTRef.current;
        const velocity = deltaY / (dt || 1);

        if (deltaY > DISMISS_THRESHOLD || velocity > VELOCITY_THRESHOLD) {
            // Dismiss
            sheetRef.current.style.transform = `translateY(100%)`;
            onClose();
        } else {
            // Bounce back
            sheetRef.current.style.transform = `translateY(0px)`;
            currentYRef.current = 0;
        }
    }, [onClose]);

    useEffect(() => {
        if (!shouldRender || !sheetRef.current) return;
        const sheet = sheetRef.current;
        
        sheet.addEventListener('touchstart', onTouchStart, { passive: false });
        sheet.addEventListener('touchmove', onTouchMove, { passive: false });
        sheet.addEventListener('touchend', onTouchEnd, { passive: true });

        return () => {
             sheet.removeEventListener('touchstart', onTouchStart);
             sheet.removeEventListener('touchmove', onTouchMove);
             sheet.removeEventListener('touchend', onTouchEnd);
        };
    }, [shouldRender, onTouchStart, onTouchMove, onTouchEnd]);


    if (!shouldRender) return null;

    return createPortal(
        <>
            <div 
                className={`bottom-sheet-backdrop ${isOpen ? 'open' : ''}`}
                onClick={onClose}
            />
            <div 
                className={`bottom-sheet ${isOpen ? 'open' : ''}`} 
                ref={sheetRef}
            >
                <div className="bottom-sheet-drag-handle" />
                <div className="bottom-sheet-content" ref={contentRef}>
                    {children}
                </div>
            </div>
        </>,
        document.body
    );
}
