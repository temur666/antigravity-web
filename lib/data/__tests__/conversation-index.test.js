/**
 * lib/data/__tests__/conversation-index.test.js
 *
 * 对 ConversationIndex 的全面单元测试。
 * 使用内存中临时数据库（/tmp），测试完自动清理。
 */

const path = require('path');
const fs = require('fs');
const ConversationIndex = require('../conversation-index');

const TEST_DB = path.join('/tmp', `conv-index-test-${Date.now()}.db`);

let index;

beforeAll(() => {
    index = new ConversationIndex(TEST_DB);
});

afterAll(() => {
    index.close();
    // 清理临时文件
    try { fs.unlinkSync(TEST_DB); } catch { }
    try { fs.unlinkSync(TEST_DB + '-wal'); } catch { }
    try { fs.unlinkSync(TEST_DB + '-shm'); } catch { }
});

// ========== insert ==========

describe('insert', () => {
    test('基本插入', () => {
        const result = index.insert('cascade-001', {
            account: 'user@test.com',
            source: 'manual',
            workspace: '/home/user/project',
            createdAt: '2026-03-10T00:00:00Z',
        });
        expect(result.changes).toBe(1);

        const row = index.get('cascade-001');
        expect(row).toBeDefined();
        expect(row.cascade_id).toBe('cascade-001');
        expect(row.account).toBe('user@test.com');
        expect(row.source).toBe('manual');
        expect(row.workspace).toBe('/home/user/project');
        expect(row.status).toBe('IDLE');
        expect(row.step_count).toBe(0);
    });

    test('INSERT OR IGNORE — 重复插入不报错', () => {
        const result = index.insert('cascade-001', {
            account: 'different@test.com',
            source: 'yolo',
        });
        expect(result.changes).toBe(0);

        // 原数据不变
        const row = index.get('cascade-001');
        expect(row.account).toBe('user@test.com');
    });

    test('cascadeId 为空时抛错', () => {
        expect(() => index.insert('')).toThrow('cascadeId is required');
        expect(() => index.insert(null)).toThrow('cascadeId is required');
    });

    test('默认值 — source 默认 manual', () => {
        index.insert('cascade-defaults', {});
        const row = index.get('cascade-defaults');
        expect(row.source).toBe('manual');
        expect(row.workspace).toBe('');
        expect(row.created_at).toBeTruthy();
    });
});

// ========== finalize ==========

describe('finalize', () => {
    test('更新已有对话的字段', () => {
        index.insert('cascade-fin', { account: 'a@b.com', source: 'yolo' });

        const result = index.finalize('cascade-fin', {
            title: 'Test Title',
            stepCount: 42,
            trajectoryId: 'traj-123',
            status: 'COMPLETED',
            markdown: '## Summary\nDone.',
            yoloTask: 'Fix all bugs',
            yoloSummary: '3 轮完成',
        });
        expect(result.changes).toBe(1);

        const row = index.get('cascade-fin');
        expect(row.title).toBe('Test Title');
        expect(row.step_count).toBe(42);
        expect(row.trajectory_id).toBe('traj-123');
        expect(row.status).toBe('COMPLETED');
        expect(row.markdown).toBe('## Summary\nDone.');
        expect(row.yolo_task).toBe('Fix all bugs');
        expect(row.yolo_summary).toBe('3 轮完成');
        expect(row.archived_at).toBeTruthy();
    });

    test('COALESCE — null 字段不覆盖已有值', () => {
        const before = index.get('cascade-fin');

        index.finalize('cascade-fin', {
            title: null,       // 不覆盖
            stepCount: 100,    // 覆盖
        });

        const after = index.get('cascade-fin');
        expect(after.title).toBe(before.title);       // 保持不变
        expect(after.step_count).toBe(100);            // 已更新
        expect(after.markdown).toBe(before.markdown);  // 保持不变
    });

    test('对不存在的 cascadeId 执行 finalize — changes 为 0', () => {
        const result = index.finalize('non-existent', { title: 'Ghost' });
        expect(result.changes).toBe(0);
    });
});

// ========== list ==========

describe('list', () => {
    beforeAll(() => {
        // 插入测试数据
        index.insert('list-a1', { account: 'alice@t.com', source: 'manual', createdAt: '2026-03-10T01:00:00Z' });
        index.insert('list-a2', { account: 'alice@t.com', source: 'yolo', createdAt: '2026-03-10T02:00:00Z' });
        index.insert('list-b1', { account: 'bob@t.com', source: 'manual', createdAt: '2026-03-10T03:00:00Z' });

        index.finalize('list-a1', { title: 'Alice Project Setup', updatedAt: '2026-03-10T05:00:00Z' });
        index.finalize('list-a2', { title: 'YOLO Debug Session', yoloTask: 'Fix lint errors', updatedAt: '2026-03-10T06:00:00Z' });
        index.finalize('list-b1', { title: 'Bob Refactoring', updatedAt: '2026-03-10T04:00:00Z' });
    });

    test('无过滤 — 返回全部', () => {
        const rows = index.list({ limit: 1000 });
        expect(rows.length).toBeGreaterThanOrEqual(3);
    });

    test('按 account 过滤', () => {
        const rows = index.list({ account: 'alice@t.com' });
        expect(rows.every(r => r.account === 'alice@t.com')).toBe(true);
        expect(rows.length).toBe(2);
    });

    test('按 source 过滤', () => {
        const rows = index.list({ source: 'yolo' });
        expect(rows.every(r => r.source === 'yolo')).toBe(true);
        expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    test('模糊搜索 title', () => {
        const rows = index.list({ search: 'Setup' });
        expect(rows.length).toBe(1);
        expect(rows[0].title).toBe('Alice Project Setup');
    });

    test('模糊搜索 yolo_task', () => {
        const rows = index.list({ search: 'lint' });
        expect(rows.length).toBe(1);
        expect(rows[0].cascade_id).toBe('list-a2');
    });

    test('分页 — limit + offset', () => {
        const page1 = index.list({ limit: 2, offset: 0 });
        const page2 = index.list({ limit: 2, offset: 2 });
        expect(page1.length).toBe(2);
        expect(page2.length).toBeGreaterThanOrEqual(1);
        // 不重叠
        const ids1 = page1.map(r => r.cascade_id);
        const ids2 = page2.map(r => r.cascade_id);
        expect(ids1.filter(id => ids2.includes(id))).toHaveLength(0);
    });

    test('按 updated_at 降序排列', () => {
        const rows = index.list({ account: 'alice@t.com' });
        // list-a2 (06:00) 应在 list-a1 (05:00) 之前
        const idx_a2 = rows.findIndex(r => r.cascade_id === 'list-a2');
        const idx_a1 = rows.findIndex(r => r.cascade_id === 'list-a1');
        expect(idx_a2).toBeLessThan(idx_a1);
    });
});

// ========== delete ==========

describe('delete', () => {
    test('删除已有对话', () => {
        index.insert('cascade-del', { account: 'del@t.com' });
        expect(index.get('cascade-del')).toBeDefined();

        const result = index.delete('cascade-del');
        expect(result.changes).toBe(1);
        expect(index.get('cascade-del')).toBeUndefined();
    });

    test('删除不存在的对话 — changes 为 0', () => {
        const result = index.delete('non-existent-id');
        expect(result.changes).toBe(0);
    });
});

// ========== upsertMany ==========

describe('upsertMany', () => {
    test('批量插入新记录', () => {
        index.upsertMany([
            { cascadeId: 'batch-1', title: 'Batch One', stepCount: 5, account: 'batch@t.com' },
            { cascadeId: 'batch-2', title: 'Batch Two', stepCount: 10, account: 'batch@t.com' },
            { cascadeId: 'batch-3', title: 'Batch Three', stepCount: 15, account: 'batch@t.com' },
        ]);

        expect(index.get('batch-1')).toBeDefined();
        expect(index.get('batch-2')).toBeDefined();
        expect(index.get('batch-3')).toBeDefined();
        expect(index.get('batch-1').title).toBe('Batch One');
    });

    test('批量 upsert — 更新已有记录', () => {
        index.upsertMany([
            { cascadeId: 'batch-1', title: 'Updated One', stepCount: 50 },
            { cascadeId: 'batch-new', title: 'Brand New', stepCount: 1 },
        ]);

        const b1 = index.get('batch-1');
        expect(b1.title).toBe('Updated One');
        expect(b1.step_count).toBe(50);

        expect(index.get('batch-new')).toBeDefined();
    });

    test('stepCount 只增不减', () => {
        index.upsertMany([
            { cascadeId: 'batch-2', title: 'Batch Two Updated', stepCount: 3 },
        ]);
        const row = index.get('batch-2');
        expect(row.step_count).toBe(10); // 保持较大值
    });

    test('空数组不报错', () => {
        expect(() => index.upsertMany([])).not.toThrow();
    });
});

// ========== stats ==========

describe('stats', () => {
    test('返回正确的统计', () => {
        const s = index.stats();
        expect(s.total).toBeGreaterThanOrEqual(5);
        expect(typeof s.byAccount).toBe('object');
        expect(typeof s.bySource).toBe('object');
    });

    test('byAccount 包含已知账户', () => {
        const s = index.stats();
        expect(s.byAccount['batch@t.com']).toBeGreaterThanOrEqual(3);
    });
});

// ========== get ==========

describe('get', () => {
    test('返回完整行', () => {
        const row = index.get('batch-1');
        expect(row).toHaveProperty('cascade_id');
        expect(row).toHaveProperty('title');
        expect(row).toHaveProperty('step_count');
        expect(row).toHaveProperty('status');
        expect(row).toHaveProperty('account');
        expect(row).toHaveProperty('created_at');
        expect(row).toHaveProperty('updated_at');
    });

    test('不存在时返回 undefined', () => {
        expect(index.get('does-not-exist')).toBeUndefined();
    });
});
