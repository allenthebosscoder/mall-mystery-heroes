import React from 'react';
import { Flex, Input, Button } from '@chakra-ui/react';

// Pure UI placeholder — real sending (text and photo) is separate,
// not-yet-built work (docs/superpowers/specs/2026-08-10-player-chat-
// messaging-design.md, "Explicitly out of scope"). No props, no state,
// no Firebase.
const MessageComposer = () => {
    return (
        <Flex p={2} borderTop="1px solid" borderColor="gray.600">
            <Input placeholder="Message coming soon..." isDisabled mr={2} />
            <Button isDisabled mr={2} aria-label="Send photo">
                📷
            </Button>
            <Button isDisabled colorScheme="teal">
                Send
            </Button>
        </Flex>
    );
};

export default MessageComposer;
