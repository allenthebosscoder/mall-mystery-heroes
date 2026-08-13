import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, List } from '@chakra-ui/react';
import { onSnapshot } from 'firebase/firestore';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';
import { normalizePlayerName } from '../../game/playerNames';
import { applyMessageChanges } from '../../utils/applyMessageChanges';
import MessageBubble from './MessageBubble';

// Live-subscribes to the room's playerMessages and filters to what this
// player should see: broadcasts/leaderboard sends (recipient: null) and
// any whisper addressed to them. Not gated on gameStarted — the feed is
// visible from the moment a player joins
// (docs/superpowers/specs/2026-08-10-player-chat-messaging-design.md).
//
// Merges via docChanges() rather than remapping the full snapshot.docs
// every time, so a message untouched by a given snapshot keeps its exact
// object reference — what lets MessageBubble's React.memo skip
// re-rendering messages that haven't changed
// (docs/superpowers/specs/2026-08-12-message-feed-render-perf-design.md).
const MessageFeed = ({ roomID, playerName }) => {
    const [allMessages, setAllMessages] = useState([]);
    const feedBoxRef = useRef(null);

    useEffect(() => {
        if (!roomID || !playerName) return undefined;
        setAllMessages([]);
        const messagesQuery = fetchPlayerMessagesQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            messagesQuery,
            (snapshot) => {
                setAllMessages((previous) => applyMessageChanges(previous, snapshot.docChanges()));
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

    const normalizedPlayerName = normalizePlayerName(playerName);
    // allMessages stays unfiltered — applyMessageChanges' newIndex is a
    // position in the query's full result set, so filtering before storing
    // would corrupt future merges. messages (below) is the filtered,
    // rendered view.
    const messages = useMemo(
        () =>
            allMessages.filter(
                (message) =>
                    !message.recipient ||
                    normalizePlayerName(message.recipient) === normalizedPlayerName
            ),
        [allMessages, normalizedPlayerName]
    );

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
                {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} playerName={playerName} />
                ))}
            </List>
        </Box>
    );
};

export default MessageFeed;
