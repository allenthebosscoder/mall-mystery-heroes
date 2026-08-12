/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * MessageComposer sends player-authored group-chat messages
 * (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
 * The photo button stays disabled — kill-photo submission is a separate,
 * not-yet-built sub-project.
 *
 * Explicit mock factory for dbCalls.js, not auto-mock — see
 * ChatInput.test.jsx for why auto-mocking utils/firebase.js isn't safe.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageComposer from './MessageComposer';
import { addChatMessageForRoom } from '../firebase_calls/dbCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    addChatMessageForRoom: jest.fn(),
}));

const mountComposer = () =>
    render(
        <ChakraProvider>
            <MessageComposer roomID="room-a" playerName="Alice" />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    addChatMessageForRoom.mockResolvedValue(undefined);
});

describe('MessageComposer', () => {
    it('renders an enabled message input and Send button', () => {
        mountComposer();

        expect(screen.getByPlaceholderText('Type a message...')).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    });

    it('renders a disabled photo button', () => {
        mountComposer();

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeDisabled();
    });

    it('sends the typed message when Send is clicked', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hey where are you');
        await userEvent.click(screen.getByRole('button', { name: 'Send' }));

        expect(addChatMessageForRoom).toHaveBeenCalledWith('hey where are you', 'Alice', 'room-a');
    });

    it('sends the typed message when Enter is pressed', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi{Enter}');

        expect(addChatMessageForRoom).toHaveBeenCalledWith('hi', 'Alice', 'room-a');
    });

    it('clears the input after sending', async () => {
        mountComposer();
        const input = screen.getByPlaceholderText('Type a message...');

        await userEvent.type(input, 'hi{Enter}');

        expect(input).toHaveValue('');
    });

    it('does not send a blank or whitespace-only message', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), '   {Enter}');

        expect(addChatMessageForRoom).not.toHaveBeenCalled();
    });
});
