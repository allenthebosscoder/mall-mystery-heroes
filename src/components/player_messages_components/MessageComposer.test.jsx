/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * MessageComposer is pure UI: a disabled text input, a disabled send
 * button, and a disabled photo button. No props, no Firebase, no state —
 * real message-sending and photo submission are separate, not-yet-built
 * features (docs/superpowers/specs/2026-08-10-player-chat-messaging-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import MessageComposer from './MessageComposer';

describe('MessageComposer', () => {
    it('renders a disabled message input', () => {
        render(
            <ChakraProvider>
                <MessageComposer />
            </ChakraProvider>
        );

        expect(screen.getByPlaceholderText('Message coming soon...')).toBeDisabled();
    });

    it('renders a disabled send button', () => {
        render(
            <ChakraProvider>
                <MessageComposer />
            </ChakraProvider>
        );

        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });

    it('renders a disabled photo button', () => {
        render(
            <ChakraProvider>
                <MessageComposer />
            </ChakraProvider>
        );

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeDisabled();
    });
});
