const assert = require('assert');
const ganache = require('ganache-cli');
const Web3 = require('web3');
// const web3 = new Web3(ganache.provider());
const web3 = new Web3(new Web3.providers.HttpProvider("http://localhost:7545"));
const CestakingJson = require('../build/contracts/CestakingFarmTest.json');
const frmJson = require('../build/contracts/CreativeLabsToken.json');
const abiDecoder = require('abi-decoder');

const STAKING_CAP = 1000;
const GAS ='5000000';

let accounts;
let Cestaking;
let frm;
let owner, contractAddress;
let ac1, ac2, ac3;

function wei(val) {
    return web3.utils.toWei(val, 'ether');
}

beforeEach(async () => {
    accounts = await web3.eth.getAccounts();
    owner = accounts[0];
    ac1 = accounts[1];
    ac2 = accounts[2];
    ac3 = accounts[3];

    frm = await new web3.eth.Contract(frmJson['abi'])
        .deploy({ data: frmJson['bytecode'] })
        .send({ from: owner, gas: GAS });
    Cestaking = await new web3.eth.Contract(CestakingJson['abi'])
        .deploy({ data: CestakingJson['bytecode'], arguments: ["Test Staking", frm._address, STAKING_CAP] })
        .send({ from: owner, gas: '5000000' });
    contractAddress = Cestaking._address;
    // Approve the owner
    await frm.methods.approve(contractAddress, STAKING_CAP).send({from: owner});
    const allowance = await frm.methods.allowance(owner, contractAddress).call();
    abiDecoder.addABI(CestakingJson['abi']);
    console.log('Owner allowance is', allowance.toString());
});

async function allow(addr, amount) {
    await frm.methods.transfer(addr, amount).send({from: owner, gas: GAS});
    await frm.methods.approve(contractAddress, amount).send({from: addr});
    const allowance = await frm.methods.allowance(addr, contractAddress).call();
    assert(allowance.toString() === amount.toString(), 'Allowance didn\'nt happen');
}

async function addReward() {
    return Cestaking.methods.addReward(1000, 500).send({from: owner, gas: GAS});
}

async function call(method, ...args) {
    return await Cestaking.methods[method](...args).call();
}

async function vars() {
    const stakedTotal = await call('stakedTotal');
    const totalReward = await call('totalReward');
    const earlyWithdrawReward = await call('earlyWithdrawReward');
    const rewardBalance = await call('rewardBalance');
    const stakedBalance = await call('stakedBalance');
    return { stakedTotal, totalReward, earlyWithdrawReward, rewardBalance, stakedBalance };
}

async function balance(addr) {
    const res = await frm.methods.balanceOf(addr).call();
    return res.toString();
}

async function debugVars() {
    const var1 = await call('var1');
    const var2 = await call('var2');
    const var3 = await call('var3');
    console.log('VARS', var1, var2, var3)
}

async function setUpStakes() {
    await addReward();
    await allow(ac1, 200);
    const tx = await Cestaking.methods.stake(100).send({from: ac1, gas: GAS});
    await getTransactionLogs(tx.transactionHash);
    let stake = await Cestaking.methods.stakeOf(ac1).call();

    await Cestaking.methods.stake(100).send({from: ac1, gas: GAS});
    stake = await Cestaking.methods.stakeOf(ac1).call();
    console.log('ac1 staked ', stake);

    await allow(ac2, 1000);
    await Cestaking.methods.stake(1000).send({from: ac2, gas: GAS});
    stake = await Cestaking.methods.stakeOf(ac2).call();
    const allowance = await frm.methods.allowance(ac2, contractAddress).call();
    console.log('ac2 staked ', stake, ' and has allowance of ', allowance, ' it tried to stake 1000 ' +
        'but cap was full and 200 goes back to account');
}

async function getTransactionLogs(txId) {
    const receipts = await web3.eth.getTransactionReceipt(txId);
    const decodedLogs = abiDecoder.decodeLogs(receipts.logs);
    decodedLogs.forEach(l => {
        if (l) {
            console.log(JSON.stringify(l));
        }
    });
    return decodedLogs.filter(Boolean);
}

describe('Happy Cestaking', () => {
    it('Sets the reward', async () => {
        const totalRewBefore = await Cestaking.methods.totalReward().call();
        assert.deepStrictEqual(totalRewBefore, '0');
        await Cestaking.methods.addReward(100, 10).send({from: owner, gas: GAS});
        let totalRewAfter = await Cestaking.methods.totalReward().call();
        assert.deepStrictEqual(totalRewAfter, '100');
        let earlyWithdrawReward = await Cestaking.methods.earlyWithdrawReward().call();
        assert.deepStrictEqual(earlyWithdrawReward, '10');

        await Cestaking.methods.addReward(50, 40).send({from: owner, gas: GAS});
        totalRewAfter = await Cestaking.methods.totalReward().call();
        assert.deepStrictEqual(totalRewAfter, '150');
        earlyWithdrawReward = await Cestaking.methods.earlyWithdrawReward().call();
        assert.deepStrictEqual(earlyWithdrawReward, '50');
    });

    it('Withdraw right after it opens gives no reward', async function() {
        this.timeout(0);
        await setUpStakes();

        // Now moving to the first moment of withdawal phase
        await Cestaking.methods.setEarlyWithdrawalPeriod(0).send({from: owner, gas: GAS});

        const before = await vars();
        assert.deepStrictEqual(before, {
            stakedTotal: '1000',
            totalReward: '1000',
            earlyWithdrawReward: '500',
            rewardBalance: '1000',
            stakedBalance: '1000',
        });
        const balanceBefore = await balance(ac2);
        assert.deepStrictEqual(balanceBefore, '200');

        // Withdraw at the first moment
        const tx = await Cestaking.methods.withdraw(400).send({from: ac2, gas: GAS});
        await getTransactionLogs(tx.transactionHash);
        let after = await vars();
        assert.deepStrictEqual(after, {
            stakedTotal: '1000',
            totalReward: '1000',
            earlyWithdrawReward: '500',
            rewardBalance: '1000',
            stakedBalance: '600',
        });
        let bal = await balance(ac2);
        assert.deepStrictEqual(bal, '600');
    });

    it('Withdraw halfway before it ends', async function () {
        this.timeout(0);
        await setUpStakes();

        // Now moving to the half way of withdawal phase
        await Cestaking.methods.setEarlyWithdrawalPeriod(30000).send({from: owner, gas: GAS});

        const before = await vars();
        assert.deepStrictEqual(before, {
            stakedTotal: '1000',
            totalReward: '1000',
            earlyWithdrawReward: '500',
            rewardBalance: '1000',
            stakedBalance: '1000',
        });

        await Cestaking.methods.withdraw(400).send({from: ac2, gas: GAS});
        let after = await vars();
        let bal = await balance(ac2);
        assert.deepStrictEqual(after, {
            stakedTotal: '1000',
            totalReward: '1000',
            earlyWithdrawReward: '500',
            rewardBalance: '900',
            stakedBalance: '600',
        });
        assert.deepStrictEqual(bal, '700');
    });

    it('Withdraw right before close', async function() {
        this.timeout(0);
        await setUpStakes();

        // Now moving to the end of withdawal phase
        await Cestaking.methods.setEarlyWithdrawalPeriod(59990).send({from: owner, gas: GAS});

        const before = await vars();
        const balanceBefore = await balance(ac2);
        assert.deepStrictEqual(before, {
            stakedTotal: '1000',
            totalReward: '1000',
            earlyWithdrawReward: '500',
            rewardBalance: '1000',
            stakedBalance: '1000',
        });
        assert.deepStrictEqual(balanceBefore, '200');

        await Cestaking.methods.withdraw(400).send({from: ac2, gas: GAS});
        let after = await vars();
        let bal = await balance(ac2);
        assert.deepStrictEqual(after, {
            stakedTotal: '1000',
            totalReward: '1000',
            earlyWithdrawReward: '500',
            rewardBalance: '801',
            stakedBalance: '600',
        });
        assert.deepStrictEqual(bal, '799');

        // Now continue after close
        await Cestaking.methods.setEarlyWithdrawalPeriod(60000).send({from: owner, gas: GAS});

        // Withdraw another 400
        await Cestaking.methods.withdraw(400).send({from: ac2, gas: GAS});
        after = await vars();
        bal = await balance(ac2);
        // After close reward and stake balance don't change
        assert.deepStrictEqual(after, {
            stakedTotal: '1000',
            totalReward: '1000',
            earlyWithdrawReward: '500',
            rewardBalance: '801',
            stakedBalance: '600',
        });
        // Here ac2 expects ~ 66% of the remaining reward
        // because my balance at the time is ~ 66% of the remaining balance
        assert.deepStrictEqual(bal, (801 * 400 / 600 + 400 + 799).toString());

        let stakes = await Cestaking.methods.stakeOf(ac2).call();
        assert.deepStrictEqual(stakes, '0');

        // Withdraw ac1
        await Cestaking.methods.withdraw(200).send({from: ac1, gas: GAS});
        bal = await balance(ac1);
        assert.deepStrictEqual(bal, (801 * 200 / 600 + 200).toString());
        stakes = await Cestaking.methods.stakeOf(ac1).call();
        assert.deepStrictEqual(stakes, '0'); // Remaining stakes is zero
    });

    it('Withdraw after close', async function() {
        this.timeout(0);
        await setUpStakes();

        // Now moving to the first moment after maturity
        await Cestaking.methods.setEarlyWithdrawalPeriod(60000).send({from: owner, gas: GAS});

        const before = await vars();
        const balanceBefore = await balance(ac2);
        assert.deepStrictEqual(before, {
            stakedTotal: '1000',
            totalReward: '1000',
            earlyWithdrawReward: '500',
            rewardBalance: '1000',
            stakedBalance: '1000',
        });
        assert.deepStrictEqual(balanceBefore, '200');

        await Cestaking.methods.withdraw(400).send({from: ac2, gas: GAS});
        let after = await vars();
        let bal = await balance(ac2);
        assert.deepStrictEqual(after, {
            stakedTotal: '1000',
            totalReward: '1000',
            earlyWithdrawReward: '500',
            rewardBalance: '1000',
            stakedBalance: '1000',
        });
        assert.deepStrictEqual(bal, (400 + 400 + 200).toString()); // reward + amount + existing balance
    });

    it('annual rate calculation', async function() {
        this.timeout(0);
        await setUpStakes();

        // Caldulate the withdraw reward rate.
        // wRate = withdrawReward/stakingCap
        // dT = withdrawEnd - stakingEnd // milliseconds
        // yearMs = 365 * 24 * 3600 * 1000
        // earlyWdRewardAnualRate = wRate * yearMs / dT
        const { stakedTotal, earlyWithdrawReward } = await vars();
        const dT = 60000;
        const yearMs = 265 * 24 * 3600 * 1000;
        const wRate = Number(earlyWithdrawReward) / Number(stakedTotal);
        const earlyWdRewardAnualRate = wRate * yearMs / dT;

        // Now do an actual withdraw and see if the reward matches expectation
        const withdrawTime = dT / 2;
        await Cestaking.methods.setEarlyWithdrawalPeriod(withdrawTime).send({from: owner, gas: GAS});
        let preBal = await balance(ac2);
        await Cestaking.methods.withdraw(400).send({from: ac2, gas: GAS});
        const withdrawed = await balance(ac2) - preBal;
        const reward = withdrawed - 400;

        console.log('Amount withdrawn:', withdrawed, ' reward', reward);
        assert.deepStrictEqual(wRate * withdrawTime / dT,reward / 400);
        const actualAnnualRate = reward / 400 * (yearMs / withdrawTime);
        console.log('Actual annual rate:', actualAnnualRate, ' vs ', earlyWdRewardAnualRate);
        assert.deepStrictEqual(actualAnnualRate,earlyWdRewardAnualRate);
    });

    it('maximum rate calculation', async function() {
        this.timeout(0);
        await setUpStakes();
        const { stakedTotal, totalReward } = await vars();
        const dT = 60000;
        const yearMs = 265 * 24 * 3600 * 1000;
        const annualize = r => r * yearMs / dT;

        // Reward at maturity will be translated to annual rate at follows:
        // Minimum reward at maturity is when no early withdrawal happens, hense:
        // minRewardRateAtMat = annualize( totalReward / stakedTotal )
        // maxRewardAtMat = totalReward
        const minRewardRateAtMat = totalReward / stakedTotal;
        const annualizedMinRewardRateAtMat = annualize( minRewardRateAtMat );

        // Now do an actual withdraw and see if the reward matches expectation
        const withdrawTime = dT + 1;
        await Cestaking.methods.setEarlyWithdrawalPeriod(withdrawTime).send({from: owner, gas: GAS});
        let preBal = await balance(ac2);
        await Cestaking.methods.withdraw(400).send({from: ac2, gas: GAS});
        const withdrawed = await balance(ac2) - preBal;
        const reward = withdrawed - 400;

        console.log('Amount withdrawn:', withdrawed, ' reward', reward);
        assert.deepStrictEqual(minRewardRateAtMat,reward / 400);
        const actualAnnualRate = reward / 400 * (yearMs / dT);
        console.log('Actual annual rate:', actualAnnualRate, ' vs ', annualizedMinRewardRateAtMat);
        assert.deepStrictEqual(actualAnnualRate, annualizedMinRewardRateAtMat);
    });

    it('stake more than cap', () => {});

    it('withdraw more than balance', () => {});

    it('withdraw before period opens', () => {});

    it('stake after period closes', () => {});

    it('stake after period closes', () => {});

    it('stake without allocation', () => {});
});
