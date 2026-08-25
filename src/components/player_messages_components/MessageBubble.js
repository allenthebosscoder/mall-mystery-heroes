import React from 'react';
import { Box, Flex, Image, List, ListItem, Text } from '@chakra-ui/react';
import { normalizePlayerName } from '../../game/playerNames';
import { formatMessageTime } from '../../utils/formatMessageTime';

// One message's rendering, extracted from MessageFeed.js and wrapped in
// React.memo so an unchanged message (same object reference, preserved by
// applyMessageChanges) is skipped entirely on re-render — the whole point
// of this split
// (docs/superpowers/specs/2026-08-12-message-feed-render-perf-design.md).
const MessageBubble = ({ message, playerName }) => {
    const mission = message.mission ?? {};
    // Only 'chat' messages have a sender to compare — every other type
    // (whisper/broadcast/leaderboard/mission) is GM-authored and has no
    // sender field at all, so this guards normalizePlayerName from being
    // called on null/undefined for those
    // (docs/superpowers/specs/2026-08-12-chat-message-bubbles-design.md).
    const isMine =
        message.sender != null &&
        normalizePlayerName(message.sender) === normalizePlayerName(playerName);
    const time = formatMessageTime(message.timestamp);

    return (
        <ListItem mb={2}>
            {message.type === 'leaderboard' ? (
                <Box bg="gray.700" borderRadius="md" p={2}>
                    <Text fontWeight="bold" mb={1}>
                        Leaderboard
                    </Text>
                    {time && (
                        <Text fontSize="xs" color="gray.400" mb={1}>
                            {time}
                        </Text>
                    )}
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
                    {time && (
                        <Text fontSize="xs" color="gray.400">
                            {time}
                        </Text>
                    )}
                </Box>
            ) : message.type === 'killPhoto' ? (
                <Box bg="gray.700" borderRadius="md" p={2}>
                    <Text fontWeight="bold" mb={1}>
                        {message.assassin} is going for {message.target}!
                    </Text>
                    <Image
                        src={message.photoUrl}
                        alt="Kill photo submission"
                        borderRadius="md"
                        maxH="200px"
                    />
                    {time && (
                        <Text fontSize="xs" color="gray.400" mt={1}>
                            {time}
                        </Text>
                    )}
                </Box>
            ) : message.type === 'chat' ? (
                <Flex
                    justifyContent={isMine ? 'flex-end' : 'flex-start'}
                    data-testid="chat-message"
                >
                    <Box
                        bg={isMine ? 'teal.700' : 'blue.900'}
                        borderRadius="md"
                        p={2}
                        maxWidth="75%"
                    >
                        {!isMine && (
                            <>
                                <Text as="span" fontWeight="bold">
                                    {message.sender}:
                                </Text>{' '}
                            </>
                        )}
                        <Text as="span">{message.text}</Text>
                        {time && (
                            <Text fontSize="xs" color="gray.400" mt={1}>
                                {time}
                            </Text>
                        )}
                    </Box>
                </Flex>
            ) : (
                <Text
                    bg={message.type === 'whisper' ? 'whiteAlpha.100' : 'gray.700'}
                    border={message.type === 'whisper' ? '1px dashed' : undefined}
                    borderColor={message.type === 'whisper' ? 'gray.400' : undefined}
                    borderRadius="md"
                    p={2}
                    display="inline-block"
                >
                    <Text as="span">{message.text}</Text>
                    {time && (
                        // Inline, not block like the other branches' timestamp
                        // lines — this branch's outer element is a <Text>
                        // (renders <p>), and a block <Text> here would nest
                        // <p> in <p>.
                        <Text as="span" fontSize="xs" color="gray.400" ml={2}>
                            {time}
                        </Text>
                    )}
                </Text>
            )}
        </ListItem>
    );
};

export default React.memo(MessageBubble);
