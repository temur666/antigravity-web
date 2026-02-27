import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InputBox } from '../InputBox';
import * as hooks from '@/store/hooks';

vi.mock('@/store/hooks', () => ({
    useAppStore: vi.fn(),
}));

// Mock the ConfigPanel so we don't need to test its internals here
vi.mock('@/components/ConfigPanel/ConfigPanel', () => ({
    ConfigPanel: () => <div data-testid="mock-config-panel">Mock Config Panel</div>,
}));

describe('InputBox', () => {
    const mockSendMessage = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // Default store mock
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(hooks.useAppStore).mockImplementation((selector: any) => {
            const state = {
                sendMessage: mockSendMessage,
                conversationStatus: 'IDLE',
                activeConversationId: 'test-convo-id',
            };
            return selector(state);
        });
    });

    it('renders textarea and buttons', () => {
        render(<InputBox />);
        expect(screen.getByPlaceholderText(/输入消息/i)).toBeInTheDocument();
        expect(screen.getByTitle(/发送/i)).toBeInTheDocument();
        expect(screen.getByTitle(/配置/i)).toBeInTheDocument();
    });

    it('sends message on Enter', async () => {
        const user = userEvent.setup();
        render(<InputBox />);
        const input = screen.getByPlaceholderText(/输入消息/i);
        await user.type(input, 'Hello World{Enter}');
        // Wait a small tick because of asynchronous behavior of some events
        expect(mockSendMessage).toHaveBeenCalledWith('Hello World');
    });

    it('shows config popover when config button is clicked', async () => {
        const user = userEvent.setup();
        render(<InputBox />);
        const configBtn = screen.getByTitle(/配置/i);

        expect(screen.queryByTestId('config-popover')).not.toBeInTheDocument();

        await user.click(configBtn);
        expect(screen.getByTestId('config-popover')).toBeInTheDocument();
    });

    it('auto-resizes textarea when typing multiline', async () => {
        const user = userEvent.setup();
        render(<InputBox />);
        const input = screen.getByPlaceholderText(/输入消息/i) as HTMLTextAreaElement;

        // Mock scrollHeight
        Object.defineProperty(input, 'scrollHeight', {
            configurable: true,
            get: () => 100,
        });

        await user.type(input, 'Line 1{Shift>}{Enter}{/Shift}Line 2');

        // style height parsing is a bit tricky, but it should be larger than auto
        expect(input.style.height).toBe('100px');
    });
});
