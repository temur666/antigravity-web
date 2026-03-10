/**
 * lib/core/conversation/__tests__/archive.test.js
 *
 * ConversationArchive 单元测试（mock LS API）
 */

const path = require('path');
const fs = require('fs');
const { ConversationArchive } = require('../archive');

const TEST_DB = path.join('/tmp', `archive-test-${Date.now()}.db`);

// Mock LS Manager
function createMockLSManager(overrides = {}) {
    return {
        ls: overrides.ls !== undefined ? overrides.ls : { port: 9999, csrf: 'test-csrf' },
        ...overrides,
    };
}

// Mock grpcCall — 通过 jest.mock 替换
jest.mock('../../ls/grpc', () => ({
    grpcCall: jest.fn(),
}));

// Mock toMarkdown
jest.mock('../../../data/format', () => ({
    toMarkdown: jest.fn((data, title) => `# ${title}\nMocked markdown content`),
}));

const { grpcCall } = require('../../ls/grpc');
const { toMarkdown } = require('../../../data/format');

let archive;

beforeEach(() => {
    archive = new ConversationArchive(createMockLSManager(), { dbPath: TEST_DB });
    jest.clearAllMocks();
});

afterEach(() => {
    archive.destroy();
});

afterAll(() => {
    try { fs.unlinkSync(TEST_DB); } catch { }
    try { fs.unlinkSync(TEST_DB + '-wal'); } catch { }
    try { fs.unlinkSync(TEST_DB + '-shm'); } catch { }
});

// ========== onCreate ==========

describe('onCreate', () => {
    test('插入新对话到索引', () => {
        archive.onCreate('c-001', {
            account: 'test@user.com',
            source: 'manual',
            workspace: '/home/project',
        });

        const row = archive.index.get('c-001');
        expect(row).toBeDefined();
        expect(row.account).toBe('test@user.com');
        expect(row.source).toBe('manual');
    });

    test('重复 onCreate 不报错（INSERT OR IGNORE）', () => {
        archive.onCreate('c-002', { account: 'a@b.com' });
        archive.onCreate('c-002', { account: 'different@b.com' });

        const row = archive.index.get('c-002');
        expect(row.account).toBe('a@b.com'); // 保持首次值
    });

    test('cascadeId 为空时安全返回', () => {
        expect(() => archive.onCreate('')).not.toThrow();
        expect(() => archive.onCreate(null)).not.toThrow();
    });
});

// ========== onComplete ==========

describe('onComplete', () => {
    test('拉取 title + trajectory 并归档', async () => {
        archive.onCreate('c-complete', { account: 'test@t.com', source: 'manual' });

        // Mock: GetAllCascadeTrajectories 返回 title
        grpcCall.mockImplementation(async (port, csrf, method) => {
            if (method === 'GetAllCascadeTrajectories') {
                return {
                    data: {
                        trajectorySummaries: {
                            'c-complete': { summary: 'Auto Title', stepCount: 10 },
                        },
                    },
                };
            }
            if (method === 'GetCascadeTrajectory') {
                return {
                    data: {
                        trajectory: { steps: [{}, {}, {}] },
                    },
                };
            }
            return { data: {} };
        });

        await archive.onComplete('c-complete', { stepCount: 10 });

        const row = archive.index.get('c-complete');
        expect(row.title).toBe('Auto Title');
        expect(row.step_count).toBe(10);
        expect(row.status).toBe('IDLE');
        expect(row.markdown).toContain('Auto Title');
        expect(row.archived_at).toBeTruthy();
        expect(toMarkdown).toHaveBeenCalled();
    });

    test('LS 不可用时仅更新 stepCount 和 status', async () => {
        const offlineArchive = new ConversationArchive(
            createMockLSManager({ ls: null }),
            { dbPath: TEST_DB },
        );

        offlineArchive.onCreate('c-offline', { account: 'off@t.com' });
        await offlineArchive.onComplete('c-offline', { stepCount: 7 });

        const row = offlineArchive.index.get('c-offline');
        expect(row.step_count).toBe(7);
        expect(row.status).toBe('IDLE');
        expect(row.markdown).toBe(''); // 无法获取
        expect(grpcCall).not.toHaveBeenCalled();

        offlineArchive.destroy();
    });

    test('使用 hint.title 跳过 _fetchTitle', async () => {
        archive.onCreate('c-hint', { account: 'h@t.com' });

        grpcCall.mockImplementation(async (port, csrf, method) => {
            if (method === 'GetCascadeTrajectory') {
                return { data: { trajectory: { steps: [] } } };
            }
            return { data: {} };
        });

        await archive.onComplete('c-hint', { title: 'Given Title', stepCount: 5 });

        const row = archive.index.get('c-hint');
        expect(row.title).toBe('Given Title');
        // 不应调用 GetAllCascadeTrajectories（因为 hint 已有 title）
        const allCalls = grpcCall.mock.calls.map(c => c[2]);
        expect(allCalls).not.toContain('GetAllCascadeTrajectories');
    });
});

// ========== onDelete ==========

describe('onDelete', () => {
    test('从索引中删除对话', () => {
        archive.onCreate('c-del', { account: 'del@t.com' });
        expect(archive.index.get('c-del')).toBeDefined();

        archive.onDelete('c-del');
        expect(archive.index.get('c-del')).toBeUndefined();
    });

    test('删除不存在的对话 — 不报错', () => {
        expect(() => archive.onDelete('non-existent')).not.toThrow();
    });
});

// ========== syncFromLS ==========

describe('syncFromLS', () => {
    test('从 LS 同步对话列表', async () => {
        grpcCall.mockResolvedValue({
            data: {
                trajectorySummaries: {
                    'sync-1': { summary: 'Conv 1', stepCount: 5, status: 'CASCADE_RUN_STATUS_IDLE' },
                    'sync-2': { summary: 'Conv 2', stepCount: 12, status: 'CASCADE_RUN_STATUS_RUNNING' },
                    'sync-3': { summary: '', stepCount: 0, status: '' },
                },
            },
        });

        const result = await archive.syncFromLS('sync-account@t.com');
        expect(result.synced).toBe(3);
        expect(result.errors).toBe(0);

        expect(archive.index.get('sync-1').title).toBe('Conv 1');
        expect(archive.index.get('sync-2').status).toBe('RUNNING');
        expect(archive.index.get('sync-3')).toBeDefined();
    });

    test('LS 不可用时返回 0', async () => {
        const offlineArchive = new ConversationArchive(
            createMockLSManager({ ls: null }),
            { dbPath: TEST_DB },
        );
        const result = await offlineArchive.syncFromLS();
        expect(result.synced).toBe(0);
        offlineArchive.destroy();
    });

    test('API 报错时返回 errors=1', async () => {
        grpcCall.mockRejectedValue(new Error('Network error'));
        const result = await archive.syncFromLS();
        expect(result.errors).toBe(1);
    });
});

// ========== mergeStatuses ==========

describe('mergeStatuses', () => {
    test('就地更新 status 和 stepCount', () => {
        const indexed = [
            { cascade_id: 'm-1', status: 'IDLE', step_count: 5 },
            { cascade_id: 'm-2', status: 'IDLE', step_count: 10 },
        ];
        const live = new Map([
            ['m-1', { status: 'RUNNING', stepCount: 8 }],
        ]);

        archive.mergeStatuses(indexed, live);

        expect(indexed[0].status).toBe('RUNNING');
        expect(indexed[0].step_count).toBe(8);
        expect(indexed[1].status).toBe('IDLE'); // 未改变
    });

    test('stepCount 只增不减', () => {
        const indexed = [{ cascade_id: 'x', status: 'IDLE', step_count: 20 }];
        const live = new Map([['x', { status: 'IDLE', stepCount: 5 }]]);

        archive.mergeStatuses(indexed, live);
        expect(indexed[0].step_count).toBe(20);
    });

    test('空 liveStatuses 不报错', () => {
        const indexed = [{ cascade_id: 'y', status: 'IDLE', step_count: 1 }];
        expect(() => archive.mergeStatuses(indexed, null)).not.toThrow();
        expect(() => archive.mergeStatuses(indexed, new Map())).not.toThrow();
    });
});
