import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InputBox } from '../InputBox';
import * as hooks from '@/store/hooks';

vi.mock('@/store/hooks', () => ({
    useAppStore: vi.fn(),
}));

describe('InputBox', () => {
    const mockSendMessage = vi.fn();
    const mockSetDraft = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(hooks.useAppStore).mockImplementation((selector: any) => {
            const state = {
                sendMessage: mockSendMessage,
                conversationStatus: 'IDLE',
                activeConversationId: 'test-convo-id',
                draftMap: {} as Record<string, string>,
                setDraft: mockSetDraft,
                cancelConversation: vi.fn(),
                conversations: [],
                selectConversation: vi.fn(),
                newChat: vi.fn(),
            };
            return selector(state);
        });
    });

    it('renders textarea and send button', () => {
        render(<InputBox />);
        expect(screen.getByPlaceholderText(/ask anything/i)).toBeInTheDocument();
        expect(screen.getByTitle(/发送/i)).toBeInTheDocument();
    });

    // skip: text 由 store draftMap 驱动，纯 mock 的 useAppStore 无法模拟响应式更新
    // send 逻辑由 store/__tests__/app-store.test.ts 的 sendMessage 用例覆盖
    it.skip('sends message on Enter', async () => {
        // 需要让 draftMap 随 setDraft 动态更新
        let currentDraft = '';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(hooks.useAppStore).mockImplementation((selector: any) => {
            const state = {
                sendMessage: mockSendMessage,
                conversationStatus: 'IDLE',
                activeConversationId: 'test-convo-id',
                draftMap: { 'test-convo-id': currentDraft } as Record<string, string>,
                setDraft: (_id: string, text: string) => { currentDraft = text; },
                cancelConversation: vi.fn(),
                conversations: [],
                selectConversation: vi.fn(),
                newChat: vi.fn(),
            };
            return selector(state);
        });

        const user = userEvent.setup();
        render(<InputBox />);
        const input = screen.getByPlaceholderText(/ask anything/i);
        await user.type(input, 'Hello World{Enter}');
        expect(mockSendMessage).toHaveBeenCalled();
    });

    it('auto-resizes textarea when typing multiline', async () => {
        let currentDraft = '';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(hooks.useAppStore).mockImplementation((selector: any) => {
            const state = {
                sendMessage: mockSendMessage,
                conversationStatus: 'IDLE',
                activeConversationId: 'test-convo-id',
                draftMap: { 'test-convo-id': currentDraft } as Record<string, string>,
                setDraft: (_id: string, text: string) => { currentDraft = text; },
                cancelConversation: vi.fn(),
                conversations: [],
                selectConversation: vi.fn(),
                newChat: vi.fn(),
            };
            return selector(state);
        });

        const user = userEvent.setup();
        render(<InputBox />);
        const input = screen.getByPlaceholderText(/ask anything/i) as HTMLTextAreaElement;

        // Mock scrollHeight
        Object.defineProperty(input, 'scrollHeight', {
            configurable: true,
            get: () => 100,
        });

        await user.type(input, 'Line 1{Shift>}{Enter}{/Shift}Line 2');

        expect(input.style.height).toBe('100px');
    });
});
