import React, { useState } from 'react';
import { Button, Heading, Text, VStack } from '@chakra-ui/react';
import LeaderboardModal from './LeaderboardModal';

// Shown in place of PlayerGame's normal waiting/target/eliminated states
// once the GM has ended the game. Presentational — standings is already
// sorted by buildLeaderboardStandings before it reaches here
// (docs/superpowers/specs/2026-08-17-player-game-over-screen-design.md).
const GameOverScreen = ({ standings }) => {
    const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
    const topThree = standings.slice(0, 3);

    return (
        <VStack align="stretch" spacing={4} mb={4}>
            <Heading size="md">Game Over</Heading>
            <Text>Please head back to the starting area.</Text>
            <VStack align="stretch" spacing={1}>
                {topThree.map((player, index) => (
                    <Text key={player.name} color={player.isAlive ? 'white' : '#b3b3b3'}>
                        {index + 1}. {player.name} — {player.score}
                        {!player.isAlive && ' (eliminated)'}
                    </Text>
                ))}
            </VStack>
            <Button onClick={() => setIsLeaderboardOpen(true)} alignSelf="flex-start">
                View Leaderboard
            </Button>
            <LeaderboardModal
                isOpen={isLeaderboardOpen}
                onClose={() => setIsLeaderboardOpen(false)}
                standings={standings}
            />
        </VStack>
    );
};

export default GameOverScreen;
