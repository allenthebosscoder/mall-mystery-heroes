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
            // matching MessageFeed's own subscription-error handling —
            // log only, no toast/alert plumbing in this simple composer.
            console.error('Error sending chat message:', error);
        }
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Enter') {
            handleSend();
        }
    };

    return (
        <Flex p={2} borderTop="1px solid" borderColor="gray.600">
            <Input
                placeholder="Type a message..."
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={handleKeyDown}
                mr={2}
            />
            <Button isDisabled mr={2} aria-label="Send photo">
                📷
            </Button>
            <Button onClick={handleSend} colorScheme="teal">
                Send
            </Button>
        </Flex>
    );
};

export default MessageComposer;
