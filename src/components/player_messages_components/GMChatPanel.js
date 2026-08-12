import React, { useEffect, useRef, useState } from 'react';
import { Box, List, ListItem, Text } from '@chakra-ui/react';
import { onSnapshot } from 'firebase/firestore';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';

// Read-only view of the players' group chat, for the GM console — a
// separate panel from the GM's own game-event Logs (different collection,
// different purpose), so the GM isn't blind to player banter
// (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
const GMChatPanel = ({ roomID }) => {
    const [messages, setMessages] = useState([]);
    const chatBoxRef = useRef(null);

    useEffect(() => {
        if (!roomID) return undefined;
        const messagesQuery = fetchPlayerMessagesQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            messagesQuery,
            (snapshot) => {
                const chatMessages = snapshot.docs
                    .map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() }))
                    .filter((message) => message.type === 'chat');
                setMessages(chatMessages);
            },
            (error) => {
                console.error('Error watching player chat:', error);
            }
        );
        return () => unsubscribe();
    }, [roomID]);

    // Same auto-scroll pattern as MessageFeed.js and GameMasterView.js's
    // logsBoxRef.
    useEffect(() => {
        const chatBox = chatBoxRef.current;
        if (!chatBox) return;
        chatBox.scrollTop = chatBox.scrollHeight;
    }, [messages]);

    return (
        <Box flex="1" overflow="auto" p={2} ref={chatBoxRef} data-testid="gm-chat-panel">
            <List styleType="none">
                {messages.map((message) => (
                    <ListItem key={message.id} mb={1}>
                        <Text as="span" fontWeight="bold">
                            {message.sender}:
                        </Text>{' '}
                        <Text as="span">{message.text}</Text>
                    </ListItem>
                ))}
            </List>
        </Box>
    );
};

export default GMChatPanel;
