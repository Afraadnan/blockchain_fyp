// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "fhevm/lib/TFHE.sol";

contract DeadMansSwitchFHE {
    address public owner;
    bool private initialized;
    euint32 private inactivityPeriod; // Encrypted inactivity period in seconds
    euint32 private lastActive;       // Encrypted last activity timestamp
    
    uint256 public totalShares;
    
    struct Beneficiary {
        address wallet;
        uint256 share;
        bool exists;
    }
    
    Beneficiary[] public beneficiaries;
    mapping(address => uint256) public beneficiaryIndices;
    
    event ContractDeployed(address indexed owner);
    event HeartbeatReceived(address indexed owner);
    event BeneficiaryAdded(address indexed beneficiary, uint256 share);
    event BeneficiaryRemoved(address indexed beneficiary);
    event BeneficiaryShareUpdated(address indexed beneficiary, uint256 newShare);
    event FundsDeposited(address indexed sender, uint256 amount);
    event FundsDistributed(address indexed beneficiary, uint256 amount);
    event InactivityVerified(euint8 encryptedInactive);
    
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
        // Convert regular uint to encrypted uint
        inactivityPeriod = TFHE.asEuint32(_inactivityPeriod);
        lastActive = TFHE.asEuint32(uint32(block.timestamp));
        initialized = true;
        emit ContractDeployed(owner);
    }
    
    function heartbeat() external onlyOwner {
        // Update the encrypted last active timestamp
        lastActive = TFHE.asEuint32(uint32(block.timestamp));
        emit HeartbeatReceived(owner);
    }
    
    function verifyInactivity() public view returns (euint8) {
        // Create encrypted current time
        euint32 currentTime = TFHE.asEuint32(uint32(block.timestamp));
        
        // Calculate the threshold time for inactivity (currentTime - inactivityPeriod)
        euint32 inactiveThreshold = TFHE.sub(currentTime, inactivityPeriod);
        
        // Check if lastActive is less than inactiveThreshold
        // If lastActive < inactiveThreshold, then the owner is inactive
        ebool isInactive = TFHE.lt(lastActive, inactiveThreshold);
        
        // Convert ebool to euint8 (0 for false, 1 for true)
        euint8 result = TFHE.select(isInactive, TFHE.asEuint8(1), TFHE.asEuint8(0));
        
        return result;
    }
    
    function checkInactivity() external {
        euint8 encryptedResult = verifyInactivity();
        emit InactivityVerified(encryptedResult);
    }
    
    // Since we can't decrypt on-chain, this function must be called with proof of inactivity
    function distributeAssets(uint8 inactivityProof) external {
        require(beneficiaries.length > 0, "No beneficiaries defined");
        require(inactivityProof == 1, "Owner must be inactive to distribute");
        
        uint256 totalBalance = address(this).balance;
        require(totalBalance > 0, "No assets to distribute");
        
        for (uint i = 0; i < beneficiaries.length; i++) {
            Beneficiary memory beneficiary = beneficiaries[i];
            if (beneficiary.exists) {
                uint256 amount = (totalBalance * beneficiary.share) / 100;
                (bool success, ) = beneficiary.wallet.call{value: amount}("");
                require(success, "Transfer failed");
                emit FundsDistributed(beneficiary.wallet, amount);
            }
        }
    }
    
    function addBeneficiary(address _wallet, uint256 _share) external onlyOwner {
        require(_wallet != address(0), "Invalid address");
        require(_share > 0 && _share <= 100, "Invalid share percentage");
        require(totalShares + _share <= 100, "Total shares exceed 100%");
        
        require(beneficiaryIndices[_wallet] == 0 && 
                (beneficiaries.length == 0 || beneficiaries[0].wallet != _wallet), 
                "Beneficiary already exists");
        
        beneficiaries.push(Beneficiary(_wallet, _share, true));
        beneficiaryIndices[_wallet] = beneficiaries.length;
        totalShares += _share;
        
        emit BeneficiaryAdded(_wallet, _share);
    }
    
    function updateBeneficiaryShare(address _wallet, uint256 _newShare) external onlyOwner {
        require(_newShare > 0 && _newShare <= 100, "Invalid share percentage");
        
        uint256 index = beneficiaryIndices[_wallet];
        require(index > 0 || (beneficiaries.length > 0 && beneficiaries[0].wallet == _wallet), "Beneficiary not found");
        
        uint256 actualIndex = index > 0 ? index - 1 : 0;
        require(beneficiaries[actualIndex].exists, "Beneficiary was removed");
        
        uint256 oldShare = beneficiaries[actualIndex].share;
        uint256 newTotalShares = totalShares - oldShare + _newShare;
        require(newTotalShares <= 100, "Total shares would exceed 100%");
        
        beneficiaries[actualIndex].share = _newShare;
        totalShares = newTotalShares;
        
        emit BeneficiaryShareUpdated(_wallet, _newShare);
    }
    
    function removeBeneficiary(address _wallet) external onlyOwner {
        uint256 index = beneficiaryIndices[_wallet];
        require(index > 0 || (beneficiaries.length > 0 && beneficiaries[0].wallet == _wallet), "Beneficiary not found");
        
        uint256 actualIndex = index > 0 ? index - 1 : 0;
        require(beneficiaries[actualIndex].exists, "Beneficiary already removed");
        
        totalShares -= beneficiaries[actualIndex].share;
        beneficiaries[actualIndex].exists = false;
        delete beneficiaryIndices[_wallet];
        
        emit BeneficiaryRemoved(_wallet);
    }
    
    function deposit() external payable {
        require(msg.value > 0, "Must send some Ether");
        emit FundsDeposited(msg.sender, msg.value);
    }
    
    function getBeneficiaryCount() external view returns (uint256) {
        return beneficiaries.length;
    }
    
    function getAllBeneficiaries() external view returns (address[] memory, uint256[] memory) {
        uint256 activeCount = 0;
        
        for (uint i = 0; i < beneficiaries.length; i++) {
            if (beneficiaries[i].exists) {
                activeCount++;
            }
        }
        
        address[] memory addresses = new address[](activeCount);
        uint256[] memory shares = new uint256[](activeCount);
        
        uint256 index = 0;
        for (uint i = 0; i < beneficiaries.length; i++) {
            if (beneficiaries[i].exists) {
                addresses[index] = beneficiaries[i].wallet;
                shares[index] = beneficiaries[i].share;
                index++;
            }
        }
        
        return (addresses, shares);
    }
    
    function emergencyWithdraw() external onlyOwner {
        (bool success, ) = owner.call{value: address(this).balance}("");
        require(success, "Transfer failed");
    }
    
    receive() external payable {
        emit FundsDeposited(msg.sender, msg.value);
    }
}
