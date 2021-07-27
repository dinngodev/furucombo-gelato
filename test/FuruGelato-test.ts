import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "chai";
import { ethers, network, waffle } from "hardhat";
import {
  IProxy,
  IRegistry,
  FuruGelato,
  DummyHandler,
  Counter,
  DummyResolver,
  IDSProxy,
  DSProxyFactory,
  DSGuard,
} from "../typechain";

const gelatoAddress = "0x3CACa7b48D0573D793d3b0279b5F0029180E83b6";
const furuProxyAddress = "0xA013AfbB9A92cEF49e898C87C060e6660E050569";
const handlerRegistryAddress = "0xd4258B13C9FADb7623Ca4b15DdA34b7b85b842C7";
const Zero = ethers.constants.HashZero;

describe("FuruGelato", function () {
  this.timeout(0);
  let user0: SignerWithAddress;
  let registryOwner: any;
  let executor: any;

  let furuProxy: IProxy;
  let registry: IRegistry;
  let dsProxy: IDSProxy;

  let dsGuard: DSGuard;
  let dsProxyFactory: DSProxyFactory;
  let furuGelato: FuruGelato;
  let handler: DummyHandler;
  let resolver: DummyResolver;
  let counter: Counter;

  before(async function () {
    [user0] = await ethers.getSigners();
    executor = await ethers.provider.getSigner(gelatoAddress);

    registry = (await ethers.getContractAt(
      "IRegistry",
      handlerRegistryAddress
    )) as IRegistry;

    const furuGelatoF = await ethers.getContractFactory("FuruGelato");
    const dsProxyFactoryF = await ethers.getContractFactory("DSProxyFactory");
    const dsGuardF = await ethers.getContractFactory("DSGuard");
    const dsProxyF = await ethers.getContractFactory("DSProxy");
    const counterF = await ethers.getContractFactory("Counter");
    const handlerF = await ethers.getContractFactory("DummyHandler");
    const resolverF = await ethers.getContractFactory("DummyResolver");

    const registryOwnerAddress = await registry.owner();

    await user0.sendTransaction({
      value: ethers.utils.parseEther("1"),
      to: registryOwnerAddress,
    });

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [registryOwnerAddress],
    });

    registryOwner = await ethers.provider.getSigner(registryOwnerAddress);

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [gelatoAddress],
    });

    const furuGelatoD = await furuGelatoF
      .connect(registryOwner)
      .deploy(gelatoAddress, furuProxyAddress);
    const dsProxyFactoryD = await dsProxyFactoryF.deploy();
    const dsGuardD = await dsGuardF.deploy();
    const counterD = await counterF.deploy();
    const handlerD = await handlerF.deploy(
      counterD.address,
      furuGelatoD.address
    );
    const resolverD = await resolverF.deploy(handlerD.address);

    furuProxy = (await ethers.getContractAt(
      "IProxy",
      furuProxyAddress
    )) as IProxy;

    dsProxyFactory = (await ethers.getContractAt(
      "DSProxyFactory",
      dsProxyFactoryD.address
    )) as DSProxyFactory;

    dsGuard = (await ethers.getContractAt(
      "DSGuard",
      dsGuardD.address
    )) as DSGuard;

    furuGelato = (await ethers.getContractAt(
      "FuruGelato",
      furuGelatoD.address
    )) as FuruGelato;

    counter = (await ethers.getContractAt(
      "Counter",
      counterD.address
    )) as Counter;

    handler = (await ethers.getContractAt(
      "DummyHandler",
      handlerD.address
    )) as DummyHandler;

    resolver = (await ethers.getContractAt(
      "DummyResolver",
      resolverD.address
    )) as DummyResolver;

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

    await registry
      .connect(registryOwner)
      .register(
        handler.address,
        ethers.utils.formatBytes32String("DummyHandler")
      );

    await user0.sendTransaction({
      value: ethers.utils.parseEther("5"),
      to: furuGelato.address,
    });

    // console.log("FuruGelato: ", furuGelato.address);
    // console.log("User0: ", user0.address);
    // console.log("FuruProsy: ", furuProxyAddress);
    // console.log("DSProxy: ", dsProxy.address);
    // console.log("DSGuard: ", dsGuard.address);
  });

  it("Only owner can whitelist resolver", async () => {
    await expect(
      furuGelato.connect(user0).whitelistResolver(resolver.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    furuGelato.connect(registryOwner).whitelistResolver(resolver.address);

    expect(await furuGelato.getWhitelistedResolvers()).to.include(
      resolver.address
    );
  });

  it("check create and cancel task", async () => {
    const taskData = handler.interface.encodeFunctionData("increaseCount", [5]);

    await expect(
      furuGelato.connect(user0).cancelTask(resolver.address, taskData)
    ).to.be.reverted;
    await expect(
      furuGelato
        .connect(user0)
        .createTask(dsProxy.address, resolver.address, taskData)
    )
      .to.emit(furuGelato, "TaskCreated")
      .withArgs(dsProxy.address, resolver.address, taskData);

    await expect(
      furuGelato
        .connect(user0)
        .createTask(dsProxy.address, resolver.address, taskData)
    ).to.be.revertedWith("FuruGelato: createTask: Sender already started task");
  });

  it("cannot exec when resolver's condition fail", async () => {
    const taskData = handler.interface.encodeFunctionData("increaseCount", [5]);

    const [execData, canExec] = await resolver.genPayloadAndCanExec(taskData);

    expect(canExec).to.be.eql(false);
  });

  it("can exec when resolver's condition passes", async () => {
    const balanceInitial_furuGelato = await ethers.provider.getBalance(
      furuGelato.address
    );
    const balanceInitial_executor = await ethers.provider.getBalance(
      gelatoAddress
    );

    const THREE_MIN = 3 * 60;

    await network.provider.send("evm_increaseTime", [THREE_MIN]);
    await network.provider.send("evm_mine", []);

    expect(await counter.count()).to.be.eql(ethers.BigNumber.from("0"));

    const taskData = handler.interface.encodeFunctionData("increaseCount", [5]);

    const [execData, canExec] = await resolver.genPayloadAndCanExec(taskData);

    expect(canExec).to.be.eql(true);

    const expectedExecData = furuProxy.interface.encodeFunctionData(
      "batchExec",
      [[handler.address], [Zero], [taskData]]
    );
    expect(expectedExecData).to.be.eql(execData);

    await furuGelato
      .connect(executor)
      .exec(
        ethers.utils.parseEther("1"),
        dsProxy.address,
        resolver.address,
        taskData,
        execData
      );

    expect(await counter.count()).to.be.eql(ethers.BigNumber.from("5"));

    expect(balanceInitial_furuGelato).to.be.gt(
      await ethers.provider.getBalance(furuGelato.address)
    );
    expect(await ethers.provider.getBalance(gelatoAddress)).to.be.gt(
      balanceInitial_executor
    );
  });
});
