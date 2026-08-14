import React, { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
    Alert,
    AlertIcon,
    Box,
    Button,
    Image,
    Input,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    Radio,
    RadioGroup,
    Stack,
} from '@chakra-ui/react';
import { compressImage } from '../../utils/compressImage';
import { uploadKillPhoto } from '../firebase_calls/storageCalls';
import { addPhotoForRoom } from '../firebase_calls/dbCalls';

// A player submits a kill-photo claim against one of their assigned
// targets — capture/pick a photo, resize/compress it client-side, upload
// to Storage, then write the photos document PhotosDisplay.js's
// moderation queue already consumes
// (docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
const KillPhotoModal = ({ isOpen, onClose, roomID, playerName, targets }) => {
    const [selectedTarget, setSelectedTarget] = useState(targets[0] ?? '');
    const [compressedBlob, setCompressedBlob] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const fileInputRef = useRef(null);

    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        setError(null);
        const blob = await compressImage(file);
        // compressImage resolves from a microtask outside any React event
        // handler by this point, so the resulting state update isn't
        // automatically batched/flushed by React's synchronous act()
        // machinery. flushSync forces the commit immediately so the
        // Submit button's enabled state is reflected in the DOM as soon
        // as this handler's caller (e.g. a test's `await`) resumes.
        flushSync(() => {
            setCompressedBlob(blob);
            setPreviewUrl(URL.createObjectURL(blob));
        });
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setError(null);
        try {
            const url = await uploadKillPhoto(roomID, compressedBlob);
            await addPhotoForRoom(roomID, playerName, selectedTarget, url);
            onClose();
        } catch (submitError) {
            console.error('Error submitting kill photo:', submitError);
            setError('Could not submit the photo. Check your connection and try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} initialFocusRef={fileInputRef}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Submit a Kill Photo</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    {targets.length > 1 && (
                        <RadioGroup value={selectedTarget} onChange={setSelectedTarget} mb={4}>
                            <Stack>
                                {targets.map((target) => (
                                    <Radio key={target} value={target}>
                                        {target}
                                    </Radio>
                                ))}
                            </Stack>
                        </RadioGroup>
                    )}
                    <Input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleFileChange}
                        aria-label="Take Photo"
                        mb={4}
                    />
                    {previewUrl && (
                        <Box mb={4}>
                            <Image src={previewUrl} alt="Kill photo preview" maxH="200px" />
                        </Box>
                    )}
                    {error && (
                        <Alert status="error" mb={4}>
                            <AlertIcon />
                            {error}
                        </Alert>
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose} mr={2}>
                        Close
                    </Button>
                    <Button
                        colorScheme="teal"
                        onClick={handleSubmit}
                        isDisabled={!compressedBlob || isSubmitting}
                        isLoading={isSubmitting}
                    >
                        Submit
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default KillPhotoModal;
