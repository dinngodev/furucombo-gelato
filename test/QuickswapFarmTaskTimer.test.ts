import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { constants, utils, Bytes } from "ethers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { IDSProxy } from "../typechain";
import { impersonateAndInjectEther } from "./utils/utils";
import { GELATO_ADDRESS } from "./utils/constants";

const gelatoAddress = GELATO_ADDRESS;

describe("QuickswapFarmTaskTimer", function () {
  this.timeout(0);
  let user0: SignerWithAddress;
  let owner: SignerWithAddress;
  let dsProxy: IDSProxy;
  let executor: any;
  let dsGuard: any;
  let dsProxyFactory: any;
  let furuGelato: any;
  let action: any;
  let aFurucombo: any;
  let aQuickswapFarm: any;
  let taskHandler: any;
  let quickswapFarmTaskTimer: any;
  let foo: any;
  let actionData: any;
  let data0: any;
  let data1: any;
  let data2: any;
  let data3: any;
  let config: any;
  let taskId: Bytes;

  const fee = ethers.utils.parseEther("0");
  beforeEach(async function () {
    [user0, owner] = await ethers.getSigners();
    executor = await impersonateAndInjectEther(gelatoAddress);

    const furuGelatoF = await ethers.getContractFactory("FuruGelatoMock");
    const actionF = await ethers.getContractFactory("ActionMock");
    const aFurucomboF = await ethers.getContractFactory("AFurucomboMock");
    const aQuickswapFarmF = await ethers.getContractFactory(
      "AQuickswapFarmMock"
    );
    const dsProxyFactoryF = await ethers.getContractFactory("DSProxyFactory");
    const dsGuardF = await ethers.getContractFactory("DSGuard");
    const dsProxyF = await ethers.getContractFactory("DSProxy");
    const quickswapFarmTaskTimerF = await ethers.getContractFactory(
      "QuickswapFarmTaskTimer"
    );
    const fooF = await ethers.getContractFactory("Foo");

    const taskHandlerF = await ethers.getContractFactory("CreateTaskHandler");

    furuGelato = await furuGelatoF.connect(owner).deploy(gelatoAddress);
    action = await actionF.deploy();
    aFurucombo = await aFurucomboF.deploy();
    aQuickswapFarm = await aQuickswapFarmF.deploy();
    dsProxyFactory = await dsProxyFactoryF.deploy();
    dsGuard = await dsGuardF.deploy();
    foo = await fooF.deploy();
    taskHandler = await taskHandlerF.deploy(furuGelato.address);
    quickswapFarmTaskTimer = await quickswapFarmTaskTimerF
      .connect(owner)
      .deploy(
        action.address,
        furuGelato.address,
        aQuickswapFarm.address,
        aFurucombo.address,
        180
      );

    const cache = await dsProxyFactory.cache();
    const dsProxyD = await dsProxyF.deploy(cache);
    dsProxy = (await ethers.getContractAt(
      "IDSProxy",
      dsProxyD.address,
      user0
    )) as IDSProxy;

    const any = await dsGuard.ANY();
    await dsGuard
      .connect(user0)
      ["permit(address,address,bytes32)"](
        furuGelato.address,
        dsProxy.address,
        any
      );

    await expect(dsProxy.connect(user0).setAuthority(dsGuard.address))
      .to.emit(dsProxy, "LogSetAuthority")
      .withArgs(dsGuard.address);

    // prepare correct action data.
    config = utils.hexlify(constants.MaxUint256);
    data0 = aQuickswapFarm.interface.encodeFunctionData("getRewardAndCharge", [
      aQuickswapFarm.address,
    ]);
    data1 = aQuickswapFarm.interface.encodeFunctionData("dQuickLeave", [1]);
    data2 = aFurucombo.interface.encodeFunctionData("injectAndBatchExec", [
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    data3 = aQuickswapFarm.interface.encodeFunctionData("stake", [
      aQuickswapFarm.address,
      1,
    ]);

    actionData = action.interface.encodeFunctionData("multiCall", [
      [
        aQuickswapFarm.address,
        aQuickswapFarm.address,
        aFurucombo.address,
        aQuickswapFarm.address,
      ],
      [config, config, config, config],
      [data0, data1, data2, data3],
    ]);

    taskId = await quickswapFarmTaskTimer.getTaskId(
      dsProxy.address,
      quickswapFarmTaskTimer.address,
      actionData
    );
  });

  describe("checker", () => {
    it("create invalid task should fail", async () => {
      const fooData = foo.interface.encodeFunctionData("bar");
      const fooConfig = utils.hexlify(constants.MaxUint256);
      const fooTarget = foo.address;
      const fooActionData = action.interface.encodeFunctionData("multiCall", [
        [fooTarget],
        [fooConfig],
        [fooData],
      ]);

      const dsCreateTask = taskHandler.interface.encodeFunctionData(
        "createTask",
        [quickswapFarmTaskTimer.address, fooActionData]
      );
      await expect(
        dsProxy.connect(user0).execute(taskHandler.address, dsCreateTask)
      ).to.be.revertedWith("Invalid tos length");
    });

    it("create task with wrong function selector should fail", async () => {
      const actionDataWrong = action.interface.encodeFunctionData("multiCall", [
        [
          aQuickswapFarm.address,
          aQuickswapFarm.address,
          aFurucombo.address,
          aQuickswapFarm.address,
        ],
        [config, config, config, config],
        [data0, data1, data2, data2],
      ]);
      const dsCreateTask = taskHandler.interface.encodeFunctionData(
        "createTask",
        [quickswapFarmTaskTimer.address, actionDataWrong]
      );

      await expect(
        dsProxy.connect(user0).execute(taskHandler.address, dsCreateTask)
      ).to.be.revertedWith("Invalid datas");
    });

    it("create task with wrong tos should fail", async () => {
      const actionDataWrong = action.interface.encodeFunctionData("multiCall", [
        [
          aQuickswapFarm.address,
          aFurucombo.address,
          aFurucombo.address,
          aQuickswapFarm.address,
        ],
        [config, config, config, config],
        [data0, data1, data2, data2],
      ]);
      const dsCreateTask = taskHandler.interface.encodeFunctionData(
        "createTask",
        [quickswapFarmTaskTimer.address, actionDataWrong]
      );

      await expect(
        dsProxy.connect(user0).execute(taskHandler.address, dsCreateTask)
      ).to.be.revertedWith("Invalid tos[1]");
    });
  });

  describe("onExec", () => {
    beforeEach(async () => {
      const dsCreateTask = taskHandler.interface.encodeFunctionData(
        "createTask",
        [quickswapFarmTaskTimer.address, actionData]
      );

      await dsProxy.connect(user0).execute(taskHandler.address, dsCreateTask);
    });

    it("should execute and set timer when condition passes", async () => {
      expect(await aQuickswapFarm.count()).to.be.eql(
        ethers.BigNumber.from("0")
      );
      expect(await aFurucombo.count()).to.be.eql(ethers.BigNumber.from("0"));

      await expect(
        furuGelato
          .connect(executor)
          .exec(
            fee,
            dsProxy.address,
            quickswapFarmTaskTimer.address,
            actionData
          )
      ).to.be.revertedWith("Not yet");

      let lastExecTime = await quickswapFarmTaskTimer.lastExecTimes(taskId);
      const THREE_MIN = 3 * 60;

      await network.provider.send("evm_increaseTime", [THREE_MIN]);
      await network.provider.send("evm_mine", []);

      await furuGelato
        .connect(executor)
        .exec(fee, dsProxy.address, quickswapFarmTaskTimer.address, actionData);
      expect(await aQuickswapFarm.count()).to.be.eql(
        ethers.BigNumber.from("3")
      );
      expect(await aFurucombo.count()).to.be.eql(ethers.BigNumber.from("1"));
      expect(await quickswapFarmTaskTimer.lastExecTimes(taskId)).to.be.gt(
        lastExecTime.add(ethers.BigNumber.from(THREE_MIN))
      );
    });
  });
});
