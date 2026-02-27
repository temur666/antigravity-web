/**
 * utils/markdown.ts — Markdown 渲染工具
 *
 * 使用 marked + highlight.js
 */

import { marked } from 'marked';
import hljs from 'highlight.js';

// 配置 marked
marked.setOptions({
    gfm: true,
    breaks: true,
});

// 自定义 renderer: 代码块高亮
const renderer = new marked.Renderer();

renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
    if (lang && hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(text, { language: lang }).value;
        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
    }
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return `<pre><code class="hljs">${escaped}</code></pre>`;
};

marked.use({ renderer });

/**
 * 将 Markdown 文本渲染为 HTML
 */
export function renderMarkdown(text: string): string {
    if (!text) return '';
    try {
        return marked.parse(text) as string;
    } catch {
        return escapeHtml(text);
    }
}

/**
 * HTML 转义
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
