// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract DeadManVault {
    address public owner;
    address public beneficiary;
    uint256 public timeout;
    uint256 public lastPingTime;
    bool public triggered;
    bool public claimed;

    constructor(address _beneficiary, uint256 _timeout) {
        owner = msg.sender;
        beneficiary = _beneficiary;
        timeout = _timeout;
        lastPingTime = block.timestamp;
        claimed = false;
        triggered = false;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyBeneficiary() {
        require(msg.sender == beneficiary, "Not beneficiary");
        _;
    }

    function ping() external onlyOwner {
        lastPingTime = block.timestamp;
    }

    function trigger() external {
        require(block.timestamp > lastPingTime + timeout, "Still active");
        triggered = true;
    }

    function claim() external onlyBeneficiary {
        require(triggered, "Not triggered yet");
        require(!claimed, "Already claimed");
        claimed = true;
        payable(beneficiary).transfer(address(this).balance);
    }

    function lastPing() external view returns (uint256) {
        return lastPingTime;
    }
    
    receive() external payable {}
}