import React, { useEffect, useRef, useState } from 'react';
import { Box, List, ListItem, Text } from '@chakra-ui/react';
import { onSnapshot } from 'firebase/firestore';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';
import { normalizePlayerName } from '../../game/playerNames';

// Live-subscribes to the room's playerMessages and filters to what this
// player should see: broadcasts/leaderboard sends (recipient: null) and
// any whisper addressed to them. Not gated on gameStarted — the feed is
// visible from the moment a player joins
// (docs/superpowers/specs/2026-08-10-player-chat-messaging-design.md).
const MessageFeed = ({ roomID, playerName }) => {
    const [messages, setMessages] = useState([]);
    const feedBoxRef = useRef(null);

    useEffect(() => {
        if (!roomID || !playerName) return undefined;
        const messagesQuery = fetchPlayerMessagesQueryForRoom(roomID);
        const normalizedName = normalizePlayerName(playerName);
        const unsubscribe = onSnapshot(
            messagesQuery,
            (snapshot) => {
                const visible = snapshot.docs
                    .map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() }))
                    .filter(
                        (message) =>
                            !message.recipient ||
                            normalizePlayerName(message.recipient) === normalizedName
                    );
                setMessages(visible);
            },
            (error) => {
                // Losing the chat feed doesn't mean this player's session is
                // invalid, unlike the room/player-doc subscriptions in
                // PlayerGame.js — log only, don't clear the session or
                // navigate away.
                console.error('Error watching messages:', error);
            }
        );
        return () => unsubscribe();
    }, [roomID, playerName]);

    // Keeps the feed pinned to the newest message as it grows, matching the
    // same pattern already built for the GM's log panel
    // (GameMasterView.js's logsBoxRef).
    useEffect(() => {
        const feedBox = feedBoxRef.current;
        if (!feedBox) return;
        feedBox.scrollTop = feedBox.scrollHeight;
    }, [messages]);

    return (
        <Box flex="1" overflow="auto" p={2} ref={feedBoxRef} data-testid="message-feed">
            <List styleType="none">
                {messages.map((message) => {
                    const mission = message.mission ?? {};
                    return (
                        <ListItem key={message.id} mb={2}>
                            {message.type === 'leaderboard' ? (
                                <Box bg="gray.700" borderRadius="md" p={2}>
                                    <Text fontWeight="bold" mb={1}>
                                        Leaderboard
                                    </Text>
                                    <List styleType="none">
                                        {(message.standings ?? []).map((entry) => (
                                            <ListItem key={entry.name}>
                                                {entry.name}: {entry.score}
                                                {!entry.isAlive ? ' (eliminated)' : ''}
                                            </ListItem>
                                        ))}
                                    </List>
                                </Box>
                            ) : message.type === 'mission' ? (
                                <Box bg="gray.700" borderRadius="md" p={2}>
                                    <Text fontWeight="bold" mb={1}>
                                        New Mission!
                                    </Text>
                                    <Text fontWeight="semibold">{mission.title}</Text>
                                    <Text mb={1}>{mission.description}</Text>
                                    <Text fontSize="sm" color="gray.400">
                                        {mission.taskType} · {mission.pointValue} points ·{' '}
                                        {mission.maxCompletions
                                            ? `Limited to ${mission.maxCompletions} players`
                                            : 'Unlimited players'}
                                    </Text>
                                </Box>
                            ) : message.type === 'chat' ? (
                                <Text bg="blue.900" borderRadius="md" p={2} display="inline-block">
                                    <Text as="span" fontWeight="bold">
                                        {message.sender}:
                                    </Text>{' '}
                                    <Text as="span">{message.text}</Text>
                                </Text>
                            ) : (
                                <Text
                                    bg={message.type === 'whisper' ? 'whiteAlpha.100' : 'gray.700'}
                                    border={message.type === 'whisper' ? '1px dashed' : undefined}
                                    borderColor={
                                        message.type === 'whisper' ? 'gray.400' : undefined
                                    }
                                    borderRadius="md"
                                    p={2}
                                    display="inline-block"
                                >
                                    <Text as="span">{message.text}</Text>
                                </Text>
                            )}
                        </ListItem>
                    );
                })}
            </List>
        </Box>
    );
};

export default MessageFeed;
