const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DeadMansSwitch", function () {
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

    // Deploy the contract
    const DeadMansSwitch = await ethers.getContractFactory("DeadMansSwitch");
    deadMansSwitch = await DeadMansSwitch.deploy(inactivityPeriod);
    await deadMansSwitch.deployed();

    // Add some ether to the contract
    await owner.sendTransaction({
      to: deadMansSwitch.address,
      value: ethers.utils.parseEther("10.0"),
    });
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await deadMansSwitch.owner()).to.equal(owner.address);
    });

    it("Should set the correct inactivity period", async function () {
      expect(await deadMansSwitch.inactivityPeriod()).to.equal(inactivityPeriod);
    });

    it("Should initialize with no beneficiaries", async function () {
      try {
        await deadMansSwitch.beneficiaries(0);
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("revert");
      }
    });

    it("Should initialize funds as not released", async function () {
      expect(await deadMansSwitch.fundsReleased()).to.equal(false);
    });
  });

  describe("Heartbeat functionality", function () {
    it("Should update lastActive when heartbeat is called by owner", async function () {
      const initialLastActive = await deadMansSwitch.lastActive();
      await time.increase(100); // Increase time by 100 seconds
      
      await deadMansSwitch.heartbeat();
      const newLastActive = await deadMansSwitch.lastActive();
      
      expect(newLastActive).to.be.gt(initialLastActive);
    });

    it("Should emit HeartbeatReceived event when heartbeat is called", async function () {
      await expect(deadMansSwitch.heartbeat())
        .to.emit(deadMansSwitch, "HeartbeatReceived")
        .withArgs(owner.address);
    });

    it("Should revert when heartbeat is called by non-owner", async function () {
      await expect(deadMansSwitch.connect(addr1).heartbeat()).to.be.revertedWith("Not the owner");
    });
  });

  describe("Beneficiary management", function () {
    it("Should add a beneficiary correctly", async function () {
      await deadMansSwitch.addBeneficiary(addr1.address);
      expect(await deadMansSwitch.beneficiaries(0)).to.equal(addr1.address);
    });

    it("Should emit BeneficiaryAdded event", async function () {
      await expect(deadMansSwitch.addBeneficiary(addr1.address))
        .to.emit(deadMansSwitch, "BeneficiaryAdded")
        .withArgs(addr1.address);
    });

    it("Should prevent adding zero address as beneficiary", async function () {
      await expect(deadMansSwitch.addBeneficiary(ethers.constants.AddressZero))
        .to.be.revertedWith("Invalid address");
    });

    it("Should prevent adding duplicate beneficiary", async function () {
      await deadMansSwitch.addBeneficiary(addr1.address);
      await expect(deadMansSwitch.addBeneficiary(addr1.address))
        .to.be.revertedWith("Beneficiary already exists");
    });

    it("Should remove a beneficiary correctly", async function () {
      await deadMansSwitch.addBeneficiary(addr1.address);
      await deadMansSwitch.addBeneficiary(addr2.address);
      
      await deadMansSwitch.removeBeneficiary(addr1.address);
      expect(await deadMansSwitch.beneficiaries(0)).to.equal(addr2.address);
      
      // Check length indirectly by trying to access an out of bounds index
      try {
        await deadMansSwitch.beneficiaries(1);
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("revert");
      }
    });

    it("Should emit BeneficiaryRemoved event", async function () {
      await deadMansSwitch.addBeneficiary(addr1.address);
      await expect(deadMansSwitch.removeBeneficiary(addr1.address))
        .to.emit(deadMansSwitch, "BeneficiaryRemoved")
        .withArgs(addr1.address);
    });

    it("Should revert when trying to remove non-existent beneficiary", async function () {
      await expect(deadMansSwitch.removeBeneficiary(addr1.address))
        .to.be.revertedWith("No beneficiaries to remove");
      
      await deadMansSwitch.addBeneficiary(addr2.address);
      await expect(deadMansSwitch.removeBeneficiary(addr1.address))
        .to.be.revertedWith("Beneficiary not found");
    });
  });

  describe("Inactivity verification", function () {
    it("Should return false before inactivity period has passed", async function () {
      expect(await deadMansSwitch.verifyInactivity()).to.equal(false);
      
      // Increase time but less than inactivity period
      await time.increase(inactivityPeriod - 100);
      expect(await deadMansSwitch.verifyInactivity()).to.equal(false);
    });

    it("Should return true after inactivity period has passed", async function () {
      // Increase time beyond inactivity period
      await time.increase(inactivityPeriod + 1);
      expect(await deadMansSwitch.verifyInactivity()).to.equal(true);
    });

    it("Should reset inactivity timer after heartbeat", async function () {
      // Increase time but less than inactivity period
      await time.increase(inactivityPeriod - 100);
      await deadMansSwitch.heartbeat();
      
      // Increase time again but less than inactivity period
      await time.increase(inactivityPeriod - 100);
      expect(await deadMansSwitch.verifyInactivity()).to.equal(false);
      
      // Increase more time to exceed inactivity period
      await time.increase(200);
      expect(await deadMansSwitch.verifyInactivity()).to.equal(true);
    });
  });

  describe("Funds release", function () {
    beforeEach(async function () {
      // Add beneficiaries
      await deadMansSwitch.addBeneficiary(addr1.address);
      await deadMansSwitch.addBeneficiary(addr2.address);
    });

    it("Should not release funds if owner is still active", async function () {
      await expect(deadMansSwitch.releaseFunds())
        .to.be.revertedWith("Owner is still active");
    });

    it("Should release funds after inactivity period", async function () {
      // Increase time beyond inactivity period
      await time.increase(inactivityPeriod + 1);
      
      const initialBalance1 = await ethers.provider.getBalance(addr1.address);
      const initialBalance2 = await ethers.provider.getBalance(addr2.address);
      
      await deadMansSwitch.releaseFunds();
      
      const finalBalance1 = await ethers.provider.getBalance(addr1.address);
      const finalBalance2 = await ethers.provider.getBalance(addr2.address);
      
      // Each beneficiary should receive 5 ETH (10 ETH / 2)
      expect(finalBalance1.sub(initialBalance1)).to.equal(ethers.utils.parseEther("5.0"));
      expect(finalBalance2.sub(initialBalance2)).to.equal(ethers.utils.parseEther("5.0"));
    });

    it("Should emit FundsReleased event", async function () {
      await time.increase(inactivityPeriod + 1);
      
      await expect(deadMansSwitch.releaseFunds())
        .to.emit(deadMansSwitch, "FundsReleased")
        .withArgs(ethers.utils.parseEther("10.0"), await time.latest() + 1);
    });

    it("Should prevent releasing funds multiple times", async function () {
      await time.increase(inactivityPeriod + 1);
      await deadMansSwitch.releaseFunds();
      
      await expect(deadMansSwitch.releaseFunds())
        .to.be.revertedWith("Funds already released");
    });

    it("Should handle uneven division of funds correctly", async function () {
      // Add a third beneficiary
      await deadMansSwitch.addBeneficiary(addr3.address);
      
      await time.increase(inactivityPeriod + 1);
      
      const initialBalance1 = await ethers.provider.getBalance(addr1.address);
      const initialBalance2 = await ethers.provider.getBalance(addr2.address);
      const initialBalance3 = await ethers.provider.getBalance(addr3.address);
      
      await deadMansSwitch.releaseFunds();
      
      const finalBalance1 = await ethers.provider.getBalance(addr1.address);
      const finalBalance2 = await ethers.provider.getBalance(addr2.address);
      const finalBalance3 = await ethers.provider.getBalance(addr3.address);
      
      // Each beneficiary should receive 3.33... ETH (10 ETH / 3)
      const expectedShare = ethers.utils.parseEther("10.0").div(3);
      expect(finalBalance1.sub(initialBalance1)).to.equal(expectedShare);
      expect(finalBalance2.sub(initialBalance2)).to.equal(expectedShare);
      expect(finalBalance3.sub(initialBalance3)).to.equal(expectedShare);
    });
  });

  describe("Update inactivity period", function () {
    it("Should update inactivity period correctly", async function () {
      const newPeriod = 60 * 24 * 60 * 60; // 60 days
      await deadMansSwitch.updateInactivityPeriod(newPeriod);
      expect(await deadMansSwitch.inactivityPeriod()).to.equal(newPeriod);
    });

    it("Should revert when non-owner tries to update period", async function () {
      const newPeriod = 60 * 24 * 60 * 60; // 60 days
      await expect(deadMansSwitch.connect(addr1).updateInactivityPeriod(newPeriod))
        .to.be.revertedWith("Not the owner");
    });

    it("Should revert when trying to set period to zero", async function () {
      await expect(deadMansSwitch.updateInactivityPeriod(0))
        .to.be.revertedWith("Period must be greater than 0");
    });
  });

  describe("Receive functionality", function () {
    it("Should accept direct ETH transfers", async function () {
      const initialBalance = await ethers.provider.getBalance(deadMansSwitch.address);
      
      // Send 1 ETH directly to the contract
      await owner.sendTransaction({
        to: deadMansSwitch.address,
        value: ethers.utils.parseEther("1.0"),
      });
      
      const finalBalance = await ethers.provider.getBalance(deadMansSwitch.address);
      expect(finalBalance.sub(initialBalance)).to.equal(ethers.utils.parseEther("1.0"));
    });
  });
});
