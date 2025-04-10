// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "fhevm/lib/TFHE.sol";

contract DeadMansSwitchFHE {
    address public owner;
    bool private initialized;

    euint32 public inactivityPeriod; // Encrypted inactivity period
    euint32 public lastActive;       // Encrypted last activity timestamp

    struct Beneficiary {
        address wallet;
        uint256 share; // Percentage share of the assets
    }

    Beneficiary[] public beneficiaries;

    // Events
    event ContractDeployed(address indexed owner, euint32 inactivityPeriod);
    event HeartbeatReceived(address indexed owner);
    event BeneficiaryAdded(address indexed beneficiary, uint256 share);
    event FundsDeposited(address indexed sender, uint256 amount);
    event InactivityVerified(ebool valid); // Emits encrypted boolean for off-chain decryption

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    constructor() {
        // Empty constructor; logic is moved to initialize()
    }

    function initialize(uint32 _inactivityPeriod) external {
        require(!initialized, "Already initialized");

        owner = msg.sender;
        inactivityPeriod = TFHE.asEuint32(_inactivityPeriod);
        lastActive = TFHE.asEuint32(uint32(block.timestamp));

        initialized = true;
        emit ContractDeployed(owner, inactivityPeriod);
    }

    function heartbeat() external onlyOwner {
        lastActive = TFHE.asEuint32(uint32(block.timestamp));
        emit HeartbeatReceived(owner);
    }

    function verifyInactivity() public returns (ebool) {
        euint32 currentTime = TFHE.asEuint32(uint32(block.timestamp));
        euint32 inactiveThreshold = TFHE.sub(currentTime, inactivityPeriod);
        ebool isInactive = TFHE.lt(lastActive, inactiveThreshold);

        emit InactivityVerified(isInactive);
        return isInactive;
    }

    function triggerSwitch() external {
        ebool inactive = verifyInactivity();
        emit InactivityVerified(inactive);
        revert("Decryption must happen off-chain");
    }

    function addBeneficiary(address _wallet, uint256 _share) external onlyOwner {
        require(_share > 0 && _share <= 100, "Invalid share percentage");
        beneficiaries.push(Beneficiary(_wallet, _share));
        emit BeneficiaryAdded(_wallet, _share);
    }

    function deposit() external payable {
        require(msg.value > 0, "Must send some Ether");
        emit FundsDeposited(msg.sender, msg.value);
    }

    receive() external payable {
        emit FundsDeposited(msg.sender, msg.value);
    }
}
