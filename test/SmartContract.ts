import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { DeadMansSwitchFHE } from "../typechain-types";

describe("DeadMansSwitchFHE Contract", function () {
  async function deployDeadMansSwitchFixture() {
    const [owner, beneficiary1, beneficiary2, attacker] = await ethers.getSigners();

    const DeadMansSwitchFactory = await ethers.getContractFactory("DeadMansSwitchFHE");
    const deadMansSwitch = await DeadMansSwitchFactory.deploy();
    await deadMansSwitch.waitForDeployment();

    const inactivityPeriod = 30 * 24 * 60 * 60;
    await deadMansSwitch.initialize(inactivityPeriod);

    await owner.sendTransaction({
      to: await deadMansSwitch.getAddress(),
      value: ethers.parseEther("1.0"),
    });

    return { deadMansSwitch, owner, beneficiary1, beneficiary2, attacker, inactivityPeriod };
  }

  describe("Deployment and Initialization", function () {
    it("Should set the correct owner", async function () {
      const { deadMansSwitch, owner } = await loadFixture(deployDeadMansSwitchFixture);
      expect(await deadMansSwitch.owner()).to.equal(owner.address);
    });

    it("Should not allow re-initialization", async function () {
      const { deadMansSwitch } = await loadFixture(deployDeadMansSwitchFixture);
      await expect(deadMansSwitch.initialize(1000)).to.be.revertedWith("Already initialized");
    });
  });

  describe("Beneficiary Management", function () {
    it("Should add a beneficiary correctly", async function () {
      const { deadMansSwitch, owner, beneficiary1 } = await loadFixture(deployDeadMansSwitchFixture);

      await deadMansSwitch.connect(owner).addBeneficiary(beneficiary1.address, 50);

      const beneficiaryCount = await deadMansSwitch.getBeneficiaryCount();
      expect(beneficiaryCount).to.equal(1);

      const [addresses, shares] = await deadMansSwitch.getAllBeneficiaries();
      expect(addresses[0]).to.equal(beneficiary1.address);
      expect(shares[0]).to.equal(50);
    });

    it("Should not allow non-owners to add beneficiaries", async function () {
      const { deadMansSwitch, attacker, beneficiary1 } = await loadFixture(deployDeadMansSwitchFixture);

      await expect(
        deadMansSwitch.connect(attacker).addBeneficiary(beneficiary1.address, 50)
      ).to.be.revertedWith("Not the owner");
    });

    it("Should track total shares correctly", async function () {
      const { deadMansSwitch, owner, beneficiary1, beneficiary2 } = await loadFixture(deployDeadMansSwitchFixture);

      await deadMansSwitch.connect(owner).addBeneficiary(beneficiary1.address, 30);
      await deadMansSwitch.connect(owner).addBeneficiary(beneficiary2.address, 40);

      expect(await deadMansSwitch.totalShares()).to.equal(70);
    });

    it("Should not allow total shares to exceed 100%", async function () {
      const { deadMansSwitch, owner, beneficiary1, beneficiary2 } = await loadFixture(deployDeadMansSwitchFixture);

      await deadMansSwitch.connect(owner).addBeneficiary(beneficiary1.address, 60);
      await expect(
        deadMansSwitch.connect(owner).addBeneficiary(beneficiary2.address, 50)
      ).to.be.revertedWith("Total shares exceed 100%");
    });

    it("Should update beneficiary shares correctly", async function () {
      const { deadMansSwitch, owner, beneficiary1 } = await loadFixture(deployDeadMansSwitchFixture);

      await deadMansSwitch.connect(owner).addBeneficiary(beneficiary1.address, 30);
      await deadMansSwitch.connect(owner).updateBeneficiaryShare(beneficiary1.address, 50);

      const [addresses, shares] = await deadMansSwitch.getAllBeneficiaries();
      expect(shares[0]).to.equal(50);
      expect(await deadMansSwitch.totalShares()).to.equal(50);
    });

    it("Should remove beneficiaries correctly", async function () {
      const { deadMansSwitch, owner, beneficiary1, beneficiary2 } = await loadFixture(deployDeadMansSwitchFixture);

      await deadMansSwitch.connect(owner).addBeneficiary(beneficiary1.address, 30);
      await deadMansSwitch.connect(owner).addBeneficiary(beneficiary2.address, 40);
      await deadMansSwitch.connect(owner).removeBeneficiary(beneficiary1.address);

      expect(await deadMansSwitch.totalShares()).to.equal(40);

      const [addresses, shares] = await deadMansSwitch.getAllBeneficiaries();
      expect(addresses.length).to.equal(1);
      expect(addresses[0]).to.equal(beneficiary2.address);
    });
  });

  describe("Heartbeat functionality", function () {
    it("Should allow owner to send heartbeat", async function () {
      const { deadMansSwitch, owner } = await loadFixture(deployDeadMansSwitchFixture);

      await expect(deadMansSwitch.connect(owner).heartbeat())
        .to.emit(deadMansSwitch, "HeartbeatReceived")
        .withArgs(owner.address);
    });

    it("Should not allow non-owners to send heartbeat", async function () {
      const { deadMansSwitch, attacker } = await loadFixture(deployDeadMansSwitchFixture);

      await expect(
        deadMansSwitch.connect(attacker).heartbeat()
      ).to.be.revertedWith("Not the owner");
    });
  });

  describe("Fund management", function () {
    it("Should accept deposits", async function () {
      const { deadMansSwitch, beneficiary1 } = await loadFixture(deployDeadMansSwitchFixture);

      const depositAmount = ethers.parseEther("0.5");
      await expect(
        deadMansSwitch.connect(beneficiary1).deposit({ value: depositAmount })
      ).to.emit(deadMansSwitch, "FundsDeposited").withArgs(beneficiary1.address, depositAmount);

      const balance = await ethers.provider.getBalance(await deadMansSwitch.getAddress());
      expect(balance).to.equal(ethers.parseEther("1.5"));
    });

    it("Should allow emergency withdrawal by owner", async function () {
      const { deadMansSwitch, owner } = await loadFixture(deployDeadMansSwitchFixture);

      const initialBalance = await ethers.provider.getBalance(owner.address);
      const tx = await deadMansSwitch.connect(owner).emergencyWithdraw();
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * (tx.gasPrice || 0n);

      const finalBalance = await ethers.provider.getBalance(owner.address);
      const contractBalance = await ethers.provider.getBalance(await deadMansSwitch.getAddress());

      expect(contractBalance).to.equal(0);
      expect(finalBalance + gasCost >= initialBalance).to.be.true;
    });
  });

  // Note: Inactivity check tests are excluded due to encrypted logic.
});
