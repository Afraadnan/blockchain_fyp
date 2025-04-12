const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Mock for TFHE operations in test environment
// This will be provided by the actual FHE environment in production
const FHEMock = {
  encryptedValues: new Map(),
  asEuint32: function(value) {
    const encValue = { type: "euint32", value, encrypted: true };
    this.encryptedValues.set(encValue, value);
    return encValue;
  },
  asEuint8: function(value) {
    const encValue = { type: "euint8", value, encrypted: true };
    this.encryptedValues.set(encValue, value);
    return encValue;
  },
  lt: function(a, b) {
    const aValue = this.encryptedValues.get(a);
    const bValue = this.encryptedValues.get(b);
    const result = { type: "ebool", value: aValue < bValue, encrypted: true };
    this.encryptedValues.set(result, aValue < bValue);
    return result;
  },
  sub: function(a, b) {
    const aValue = this.encryptedValues.get(a);
    const bValue = this.encryptedValues.get(b);
    const result = { type: "euint32", value: aValue - bValue, encrypted: true };
    this.encryptedValues.set(result, aValue - bValue);
    return result;
  },
  select: function(condition, a, b) {
    const condValue = this.encryptedValues.get(condition);
    const result = condValue ? a : b;
    return result;
  },
  decrypt: function(encValue) {
    return this.encryptedValues.get(encValue);
  }
};

describe("DeadMansSwitchFHE", function () {
  let deadMansSwitch;
  let owner;
  let addr1;
  let addr2;
  let addr3;
  let addrs;
  const inactivityPeriod = 30 * 24 * 60 * 60; // 30 days in seconds

  beforeEach(async function () {
    // Get signers
    [owner, addr1, addr2, addr3, ...addrs] = await ethers.getSigners();

    // Normally we would set up the FHE environment here
    // For testing purposes, we'll mock the TFHE library
    const TFHEMock = await ethers.getContractFactory("TFHEMock");
    const tfheMock = await TFHEMock.deploy();

    // Deploy contract with TFHE mock
    const DeadMansSwitchFHE = await ethers.getContractFactory("DeadMansSwitchFHE", {
      libraries: {
        TFHE: tfheMock.address
      }
    });
    deadMansSwitch = await DeadMansSwitchFHE.deploy();

    // Initialize the contract
    await deadMansSwitch.initialize(inactivityPeriod);

    // Add some ether to the contract
    await owner.sendTransaction({
      to: deadMansSwitch.address,
      value: ethers.utils.parseEther("10.0"),
    });
  });

  describe("Deployment and Initialization", function () {
    it("Should set the right owner", async function () {
      expect(await deadMansSwitch.owner()).to.equal(owner.address);
    });

    it("Should prevent re-initialization", async function () {
      await expect(deadMansSwitch.initialize(inactivityPeriod))
        .to.be.revertedWith("Already initialized");
    });

    it("Should initialize with no beneficiaries", async function () {
      expect(await deadMansSwitch.getBeneficiaryCount()).to.equal(0);
      const [addresses, shares] = await deadMansSwitch.getAllBeneficiaries();
      expect(addresses.length).to.equal(0);
      expect(shares.length).to.equal(0);
    });
  });

  describe("Heartbeat functionality", function () {
    it("Should emit HeartbeatReceived event when heartbeat is called", async function () {
      await expect(deadMansSwitch.heartbeat())
        .to.emit(deadMansSwitch, "HeartbeatReceived")
        .withArgs(owner.address);
    });

    it("Should revert when heartbeat is called by non-owner", async function () {
      await expect(deadMansSwitch.connect(addr1).heartbeat())
        .to.be.revertedWith("Not the owner");
    });
  });

  describe("Beneficiary management", function () {
    it("Should add a beneficiary correctly", async function () {
      await deadMansSwitch.addBeneficiary(addr1.address, 50);
      
      const beneficiary = await deadMansSwitch.beneficiaries(0);
      expect(beneficiary.wallet).to.equal(addr1.address);
      expect(beneficiary.share).to.equal(50);
      expect(beneficiary.exists).to.equal(true);
      
      expect(await deadMansSwitch.totalShares()).to.equal(50);
    });

    it("Should emit BeneficiaryAdded event", async function () {
      await expect(deadMansSwitch.addBeneficiary(addr1.address, 50))
        .to.emit(deadMansSwitch, "BeneficiaryAdded")
        .withArgs(addr1.address, 50);
    });

    it("Should prevent adding zero address as beneficiary", async function () {
      await expect(deadMansSwitch.addBeneficiary(ethers.constants.AddressZero, 50))
        .to.be.revertedWith("Invalid address");
    });

    it("Should prevent adding beneficiary with invalid share", async function () {
      await expect(deadMansSwitch.addBeneficiary(addr1.address, 0))
        .to.be.revertedWith("Invalid share percentage");
      
      await expect(deadMansSwitch.addBeneficiary(addr1.address, 101))
        .to.be.revertedWith("Invalid share percentage");
    });

    it("Should prevent adding duplicate beneficiary", async function () {
      await deadMansSwitch.addBeneficiary(addr1.address, 50);
      await expect(deadMansSwitch.addBeneficiary(addr1.address, 30))
        .to.be.revertedWith("Beneficiary already exists");
    });

    it("Should prevent exceeding 100% total shares", async function () {
      await deadMansSwitch.addBeneficiary(addr1.address, 60);
      await deadMansSwitch.addBeneficiary(addr2.address, 30);
      
      await expect(deadMansSwitch.addBeneficiary(addr3.address, 20))
        .to.be.revertedWith("Total shares exceed 100%");
    });

    it("Should update beneficiary share correctly", async function () {
      await deadMansSwitch.addBeneficiary(addr1.address, 50);
      await deadMansSwitch.updateBeneficiaryShare(addr1.address, 70);
      
      const beneficiary = await deadMansSwitch.beneficiaries(0);
      expect(beneficiary.share).to.equal(70);
      expect(await deadMansSwitch.totalShares()).to.equal(70);
    });

    it("Should emit BeneficiaryShareUpdated event", async function () {
      await deadMansSwitch.addBeneficiary(addr1.address, 50);
      
      await expect(deadMansSwitch.updateBeneficiaryShare(addr1.address, 70))
        .to.emit(deadMansSwitch, "BeneficiaryShareUpdated")
        .withArgs(addr1.address, 70);
    });

    it("Should remove beneficiary correctly", async function () {
      await deadMansSwitch.addBeneficiary(addr1.address, 50);
      await deadMansSwitch.removeBeneficiary(addr1.address);
      
      const beneficiary = await deadMansSwitch.beneficiaries(0);
      expect(beneficiary.exists).to.equal(false);
      expect(await deadMansSwitch.totalShares()).to.equal(0);
    });

    it("Should emit BeneficiaryRemoved event", async function () {
      await deadMansSwitch.addBeneficiary(addr1.address, 50);
      
      await expect(deadMansSwitch.removeBeneficiary(addr1.address))
        .to.emit(deadMansSwitch, "BeneficiaryRemoved")
        .withArgs(addr1.address);
    });

    it("Should revert when trying to remove non-existent beneficiary", async function () {
      await expect(deadMansSwitch.removeBeneficiary(addr1.address))
        .to.be.revertedWith("Beneficiary not found");
    });

    it("Should get correct beneficiary count", async function () {
      expect(await deadMansSwitch.getBeneficiaryCount()).to.equal(0);
      
      await deadMansSwitch.addBeneficiary(addr1.address, 30);
      await deadMansSwitch.addBeneficiary(addr2.address, 40);
      
      expect(await deadMansSwitch.getBeneficiaryCount()).to.equal(2);
      
      await deadMansSwitch.removeBeneficiary(addr1.address);
      // Count should still be 2 since we don't physically remove elements
      expect(await deadMansSwitch.getBeneficiaryCount()).to.equal(2);
    });

    it("Should return all active beneficiaries", async function () {
      await deadMansSwitch.addBeneficiary(addr1.address, 30);
      await deadMansSwitch.addBeneficiary(addr2.address, 40);
      await deadMansSwitch.addBeneficiary(addr3.address, 20);
      
      // Remove one beneficiary
      await deadMansSwitch.removeBeneficiary(addr2.address);
      
      const [addresses, shares] = await deadMansSwitch.getAllBeneficiaries();
      
      expect(addresses.length).to.equal(2);
      expect(shares.length).to.equal(2);
      
      expect(addresses[0]).to.equal(addr1.address);
      expect(shares[0]).to.equal(30);
      
      expect(addresses[1]).to.equal(addr3.address);
      expect(shares[1]).to.equal(20);
    });
  });

  describe("Inactivity verification", function () {
    it("Should emit InactivityVerified event when checking inactivity", async function () {
      await expect(deadMansSwitch.checkInactivity())
        .to.emit(deadMansSwitch, "InactivityVerified");
    });

    // Note: In a real FHE environment, we would use the FHE libraries to decrypt and verify results
    // For this test, we're just checking that the event is emitted
  });

  describe("Funds management", function () {
    beforeEach(async function () {
      // Add beneficiaries
      await deadMansSwitch.addBeneficiary(addr1.address, 60);
      await deadMansSwitch.addBeneficiary(addr2.address, 40);
    });

    it("Should distribute assets correctly with inactivity proof", async function () {
      const initialBalance1 = await ethers.provider.getBalance(addr1.address);
      const initialBalance2 = await ethers.provider.getBalance(addr2.address);
      
      // Simulate that inactivity has been verified (proof value 1)
      await deadMansSwitch.distributeAssets(1);
      
      const finalBalance1 = await ethers.provider.getBalance(addr1.address);
      const finalBalance2 = await ethers.provider.getBalance(addr2.address);
      
      // addr1 should receive 60% of 10 ETH = 6 ETH
      expect(finalBalance1.sub(initialBalance1)).to.equal(ethers.utils.parseEther("6.0"));
      
      // addr2 should receive 40% of 10 ETH = 4 ETH
      expect(finalBalance2.sub(initialBalance2)).to.equal(ethers.utils.parseEther("4.0"));
    });

    it("Should revert distribution without inactivity proof", async function () {
      await expect(deadMansSwitch.distributeAssets(0))
        .to.be.revertedWith("Owner must be inactive to distribute");
    });

    it("Should emit FundsDeposited event on deposit", async function () {
      await expect(deadMansSwitch.deposit({ value: ethers.utils.parseEther("1.0") }))
        .to.emit(deadMansSwitch, "FundsDeposited")
        .withArgs(owner.address, ethers.utils.parseEther("1.0"));
    });

    it("Should emit FundsDeposited event on direct transfer", async function () {
      await expect(owner.sendTransaction({
        to: deadMansSwitch.address,
        value: ethers.utils.parseEther("1.0"),
      }))
        .to.emit(deadMansSwitch, "FundsDeposited")
        .withArgs(owner.address, ethers.utils.parseEther("1.0"));
    });

    it("Should emit FundsDistributed event when assets are distributed", async function () {
      await expect(deadMansSwitch.distributeAssets(1))
        .to.emit(deadMansSwitch, "FundsDistributed")
        .withArgs(addr1.address, ethers.utils.parseEther("6.0"));
    });

    it("Should allow emergency withdrawal by owner", async function () {
      const initialBalance = await ethers.provider.getBalance(owner.address);
      
      // Account for gas costs in the transaction
      const tx = await deadMansSwitch.emergencyWithdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(tx.gasPrice);
      
      const finalBalance = await ethers.provider.getBalance(owner.address);
      
      // Owner should receive the contract balance (10 ETH) minus gas costs
      expect(finalBalance.add(gasUsed).sub(initialBalance)).to.equal(ethers.utils.parseEther("10.0"));
    });

    it("Should revert emergency withdrawal by non-owner", async function () {
      await expect(deadMansSwitch.connect(addr1).emergencyWithdraw())
        .to.be.revertedWith("Not the owner");
    });
  });

  // Note: This test suite would typically be run against a specialized fhEVM environment
  // that supports the FHE operations. The current implementation uses mocks for testing purposes.
});
