import React, { useState } from 'react';
import AssassinSelection from "./AssassinsSelection";
import KillButton from "./KillButton";
import TargetSelection from "./TargetSelection";
import { Flex } from '@chakra-ui/react';

const KillActionExecution = () => {
    const [assassinPlayerNamed, setAssassinPlayerNamed] = useState('');
    const [possibleTargets, setPossibleTargets] = useState([]);
    const [selectedTarget, setSelectedTarget] = useState('');

    const getAssassinPlayerName = (assassinName) => {
        setAssassinPlayerNamed(assassinName);
        console.log('assassin name: ', assassinName);
    };

    const getPossibleTargets = (targets) => {
        setPossibleTargets(targets);
    }

    const getSelectedTarget = (target) => {
        setSelectedTarget(target);
        console.log('selected target: ', target);
    }

    const handleChoiceReset = () => {
        setAssassinPlayerNamed('');
        setPossibleTargets([]);
        setSelectedTarget('');
    }

    return (  
        <Flex
            direction = 'row'
            justifyContent = 'center'
            alignItems = 'center'
        >
            <Flex
                w = '30%'
            >
                <AssassinSelection
                    getAssassinPlayerName = {getAssassinPlayerName}
                    getPossibleTargets = {getPossibleTargets}
                    assassinPlayerNamed = {assassinPlayerNamed}
                    getSelectedTarget = {getSelectedTarget}
                />
            </Flex>
            <Flex>
                <KillButton 
                    assassinPlayerNamed = {assassinPlayerNamed}
                    selectedTarget = {selectedTarget}
                    possibleTargets = {possibleTargets}
                    getPossibleTargets = {getPossibleTargets}
                    handleChoiceReset = {handleChoiceReset}
                />
            </Flex>
            <Flex>
                <TargetSelection
                    possibleTargets = {possibleTargets}
                    getSelectedTarget = {getSelectedTarget}
                    selectedTarget = {selectedTarget}
                />
            </Flex>
        </Flex>
    );
}
 
export default KillActionExecution;