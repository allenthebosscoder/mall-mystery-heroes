import React, { useState } from 'react';
import { Flex, Input, Button } from '@chakra-ui/react';
import { addChatMessageForRoom } from '../firebase_calls/dbCalls';

// Sends player-authored group-chat messages
// (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
// The photo button stays disabled — kill-photo submission is a separate,
// not-yet-built sub-project.
const MessageComposer = ({ roomID, playerName }) => {
    const [text, setText] = useState('');

    const handleSend = async () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setText('');
        try {
            await addChatMessageForRoom(trimmed, playerName, roomID);
        } catch (error) {
            // Losing a single sent message isn't session-invalidating,
            // matching MessageFeed's own subscription-error handling — log
            // only, no toast/alert plumbing in this simple composer. The
            // typed text is restored (not left cleared) so a failed send
            // doesn't lose the player's words with no way to retry.
            console.error('Error sending chat message:', error);
            setText(trimmed);
        }
    };

    const handleKeyDown = (event) => {
        // Guards Shift+Enter (would insert a newline, if this ever becomes
        // multiline) and IME composition (an Enter keystroke that's
        // confirming a composed character, not submitting the message).
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            handleSend();
        }
    };

    // playerName can be empty when the stored session's room doesn't match
    // the URL (PlayerGame.js) — MessageFeed.js already guards its
    // subscription on the same condition; this keeps the composer from
    // attempting a chat write with sender: ''.
    const disabled = !playerName;

    return (
        <Flex p={2} borderTop="1px solid" borderColor="gray.600">
            <Input
                placeholder="Type a message..."
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={handleKeyDown}
                isDisabled={disabled}
                mr={2}
            />
            <Button isDisabled mr={2} aria-label="Send photo">
                📷
            </Button>
            <Button onClick={handleSend} colorScheme="teal" isDisabled={disabled}>
                Send
            </Button>
        </Flex>
    );
};

export default MessageComposer;
