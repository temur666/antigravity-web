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
        return `<div class="code-block-wrapper"><pre><code class="hljs language-${lang}">${highlighted}</code></pre></div>`;
    }
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return `<div class="code-block-wrapper"><pre><code class="hljs">${escaped}</code></pre></div>`;
};

// 自定义链接渲染：拦截 file:// 协议
renderer.link = function ({ href, text }: { href: string; text: string }) {
    if (href && href.startsWith('file:///')) {
        // file:///home/user/project/docs/foo.md → docs/foo.md
        const absPath = href.slice(7); // 去掉 file://
        return `<a class="file-link" data-file-path="${escapeHtml(absPath)}" href="#" title="${escapeHtml(absPath)}">${text || absPath}</a>`;
    }
    // 普通链接：新窗口打开
    return `<a href="${escapeHtml(href || '')}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};

// 自定义表格渲染：外层包裹 wrapper 支持横向滚动
const defaultRenderer = new marked.Renderer();
renderer.table = function (token: Parameters<typeof defaultRenderer.table>[0]) {
    const html = defaultRenderer.table.call(this, token);
    return `<div class="table-wrapper">${html}</div>`;
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
