/**
 * NotesPage — 单篇笔记编辑器
 *
 * 功能：
 *   - contentEditable 富文本输入
 *   - 选中文字后点击工具栏按钮进行高亮（<mark> 标签）
 *   - 再次点击可取消高亮
 *   - 内容自动保存到 localStorage（防抖 500ms）
 */
import { useRef, useEffect, useCallback } from 'react';
import { Highlighter } from 'lucide-react';

const STORAGE_KEY = 'antigravity_notes_content';
const SAVE_DEBOUNCE_MS = 500;

export function NotesPage() {
    const editorRef = useRef<HTMLDivElement>(null);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── 初始化：从 localStorage 加载内容 ──
    useEffect(() => {
        const el = editorRef.current;
        if (!el) return;
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            el.innerHTML = saved;
        }
    }, []);

    // ── 防抖保存 ──
    const scheduleStorage = useCallback(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            const el = editorRef.current;
            if (el) {
                localStorage.setItem(STORAGE_KEY, el.innerHTML);
            }
        }, SAVE_DEBOUNCE_MS);
    }, []);

    // ── 高亮切换 ──
    const toggleHighlight = useCallback(() => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const editor = editorRef.current;
        if (!editor || !editor.contains(range.commonAncestorContainer)) return;

        // 检查选区是否在 <mark> 内
        const parentMark = findParentMark(range.commonAncestorContainer);

        if (parentMark && range.toString().length === 0) {
            // 光标在 mark 内但没选中文字 → 取消整个 mark 的高亮
            unwrapMark(parentMark);
        } else if (range.toString().length > 0) {
            // 有选中文字
            if (isFullyInsideMark(range)) {
                // 选中的文字全在 mark 内 → 取消高亮
                unwrapRange(range);
            } else {
                // 选中文字不在 mark 内 → 添加高亮
                const mark = document.createElement('mark');
                mark.className = 'note-highlight';
                try {
                    range.surroundContents(mark);
                } catch {
                    // surroundContents 在跨节点时会失败，用 extractContents 做 fallback
                    const fragment = range.extractContents();
                    mark.appendChild(fragment);
                    range.insertNode(mark);
                }
            }
        }

        selection.removeAllRanges();
        scheduleStorage();
    }, [scheduleStorage]);

    return (
        <div className="notes-page">
            <div className="notes-toolbar">
                <button
                    className="notes-toolbar-btn"
                    onClick={toggleHighlight}
                    title="高亮选中文字"
                    aria-label="Toggle highlight"
                >
                    <Highlighter size={18} />
                </button>
            </div>
            <div
                ref={editorRef}
                className="notes-editor"
                contentEditable
                suppressContentEditableWarning
                onInput={scheduleStorage}
                data-placeholder="写点什么..."
            />
        </div>
    );
}

// ── 工具函数 ──

/** 向上查找最近的 <mark> 祖先 */
function findParentMark(node: Node | null): HTMLElement | null {
    let current = node;
    while (current) {
        if (
            current.nodeType === Node.ELEMENT_NODE &&
            (current as HTMLElement).tagName === 'MARK'
        ) {
            return current as HTMLElement;
        }
        current = current.parentNode;
    }
    return null;
}

/** 判断 range 是否完全在某个 <mark> 内 */
function isFullyInsideMark(range: Range): boolean {
    return findParentMark(range.commonAncestorContainer) !== null;
}

/** 移除一个 <mark> 标签，保留其子内容 */
function unwrapMark(mark: HTMLElement) {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
}

/** 取消 range 内的高亮（移除包裹的 mark） */
function unwrapRange(range: Range) {
    const mark = findParentMark(range.commonAncestorContainer);
    if (mark) {
        unwrapMark(mark);
    }
}
