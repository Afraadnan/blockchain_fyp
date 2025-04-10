// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DeadMansSwitch {
    address public owner;
    uint256 public inactivityPeriod;
    uint256 public lastActive;
    address[] public beneficiaries;
    
    event HeartbeatReceived(address indexed owner);
    event InactivityVerified(bool valid);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    constructor(uint256 _inactivityPeriod) {
        owner = msg.sender;
        inactivityPeriod = _inactivityPeriod;
        lastActive = block.timestamp;
    }

    function heartbeat() external onlyOwner {
        lastActive = block.timestamp;
        emit HeartbeatReceived(owner);
    }

    function verifyInactivity() public {
        bool isInactive = block.timestamp >= (lastActive + inactivityPeriod);
        emit InactivityVerified(isInactive);
    }

    // Add beneficiaries
    function addBeneficiary(address _beneficiary) external onlyOwner {
        beneficiaries.push(_beneficiary);
    }
}
