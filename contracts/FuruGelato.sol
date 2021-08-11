// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import {Gelatofied} from "./Gelatofied.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {
    EnumerableSet
} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IDSProxy} from "./interfaces/IDSProxy.sol";
import {Resolver} from "./Resolver.sol";
import {ResolverWhitelist} from "./ResolverWhitelist.sol";
import {TaskBlacklist} from "./TaskBlacklist.sol";
import {DSProxyTask} from "./DSProxyTask.sol";

contract FuruGelato is
    Ownable,
    Gelatofied,
    DSProxyTask,
    ResolverWhitelist,
    TaskBlacklist
{
    using EnumerableSet for EnumerableSet.Bytes32Set;

    string public constant VERSION = "0.0.1";
    mapping(bytes32 => address) public taskCreator;
    mapping(address => EnumerableSet.Bytes32Set) internal _createdTasks;

    event TaskCreated(
        address indexed taskCreator,
        bytes32 taskId,
        address indexed resolverAddress,
        bytes executionData
    );
    event TaskCancelled(
        address indexed taskCreator,
        bytes32 taskId,
        address indexed resolverAddress,
        bytes executionData
    );
    event ExecSuccess(
        uint256 indexed txFee,
        address indexed feeToken,
        address indexed taskExecutor,
        bytes32 taskId
    );

    event LogFundsDeposited(address indexed sender, uint256 amount);
    event LogFundsWithdrawn(
        address indexed sender,
        uint256 amount,
        address receiver
    );

    constructor(address payable _gelato) Gelatofied(_gelato) {}

    receive() external payable {
        emit LogFundsDeposited(msg.sender, msg.value);
    }

    /// Task related
    function createTask(address _resolverAddress, bytes calldata _resolverData)
        external
        onlyValidResolver(_resolverAddress)
    {
        (, bytes memory executionData) =
            Resolver(_resolverAddress).checker(msg.sender, _resolverData);
        bytes32 taskId = getTaskId(msg.sender, _resolverAddress, executionData);
        require(
            taskCreator[taskId] == address(0),
            "FuruGelato: createTask: Sender already started task"
        );
        _createdTasks[msg.sender].add(taskId);
        taskCreator[taskId] = msg.sender;

        require(
            Resolver(_resolverAddress).onCreateTask(msg.sender, executionData),
            "FuruGelato: createTask: onCreateTask() failed"
        );

        emit TaskCreated(msg.sender, taskId, _resolverAddress, executionData);
    }

    function cancelTask(address _resolverAddress, bytes calldata _executionData)
        external
    {
        bytes32 taskId =
            getTaskId(msg.sender, _resolverAddress, _executionData);

        require(
            taskCreator[taskId] == msg.sender,
            "FuruGelato: cancelTask: Sender did not start task yet"
        );

        _createdTasks[msg.sender].remove(taskId);
        delete taskCreator[taskId];

        require(
            Resolver(_resolverAddress).onCancelTask(msg.sender, _executionData),
            "FuruGelato: cancelTask: onCancelTask() failed"
        );

        emit TaskCancelled(
            msg.sender,
            taskId,
            _resolverAddress,
            _executionData
        );
    }

    function exec(
        uint256 _fee,
        address _proxy,
        address _resolverAddress,
        bytes calldata _executionData
    ) external gelatofy(_fee, ETH) onlyValidResolver(_resolverAddress) {
        bytes32 taskId = getTaskId(_proxy, _resolverAddress, _executionData);
        require(isValidTask(taskId), "FuruGelato: exec: invalid task");
        address action = Resolver(_resolverAddress).action();

        require(
            _proxy == taskCreator[taskId],
            "FuruGelato: exec: No task found"
        );

        try IDSProxy(_proxy).execute(action, _executionData) {} catch {
            revert("FuruGelato: exec: execute failed");
        }

        require(
            Resolver(_resolverAddress).onExec(_proxy, _executionData),
            "FuruGelato: exec: onExec() failed"
        );

        emit ExecSuccess(_fee, ETH, _proxy, taskId);
    }

    function getTaskIdsByUser(address _taskCreator)
        external
        view
        returns (bytes32[] memory)
    {
        uint256 length = _createdTasks[_taskCreator].length();
        bytes32[] memory taskIds = new bytes32[](length);

        for (uint256 i; i < length; i++) {
            taskIds[i] = _createdTasks[_taskCreator].at(i);
        }

        return taskIds;
    }

    /// Funds related
    function withdrawFunds(uint256 _amount, address payable _receiver)
        external
        onlyOwner
    {
        (bool success, ) = _receiver.call{value: _amount}("");
        require(success, "FuruGelato: withdrawFunds: Withdraw funds failed");

        emit LogFundsWithdrawn(msg.sender, _amount, _receiver);
    }
}
