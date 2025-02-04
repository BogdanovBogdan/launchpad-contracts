
import '@nomiclabs/hardhat-ethers'
import { ethers } from 'hardhat'
import hre from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Contract } from '@ethersproject/contracts'
import IDIAVoucher from '../abi/IDIAVoucher.json'
import GenericToken from '../artifacts/contracts/GenericToken.sol/GenericToken.json'
import BatchMintParams from '../scripts/inputs/BatchMintParams.json'
import { expect } from 'chai'
import { BigNumber } from '@ethersproject/bignumber'

export default describe.skip('Solv Voucher', function () {
  // wallet address
  const MINTER_ADDRESS = '0x22b6eb86Dc704E34b4C729cFeab6CaA4F57EfeE7'
  const ADMIN_ADDRESS = '0x21Bc9179d5c529B52e3EE8f6Ecf0e63FA231d16C'

  // contract address
  const IDIA_VOUCHER_ADDRESS = '0x039Bb4b13F252597a69fA2e6ad19034E3CCbbF1C'
  const VESTINGPOOL_ADDRESS = '0x67D48Ce0E776147B0d996e1FaCC0FbAA91b1CBC4'
  const PROXY_ADDRESS = '0x0c491ac26d2cdda63667df65b43b967b9293161c'
  const IDIA_ADDRESS = '0x0b15Ddf19D47E6a86A56148fb4aFFFc6929BcB89'

  // minter and contract instance
  let minter: SignerWithAddress
  let user: SignerWithAddress
  let voucherContract: Contract
  let sourceContract: Contract
  let idiaContract: Contract


  it('can impersonate', async function () {
    await hre.network.provider.request({
            method: 'hardhat_impersonateAccount',
            params: [MINTER_ADDRESS],
    })
    minter = await ethers.getSigner(MINTER_ADDRESS)
    user = (await hre.ethers.getSigners())[0]
    idiaContract = new ethers.Contract(IDIA_ADDRESS, GenericToken.abi, minter)
    sourceContract = new ethers.Contract(IDIA_VOUCHER_ADDRESS, IDIAVoucher, minter)
    voucherContract = sourceContract.attach(PROXY_ADDRESS)
    const TRANSFER_AMOUNT = ethers.constants.WeiPerEther
    const initialBalance = await idiaContract.balanceOf(ADMIN_ADDRESS)
    await idiaContract.connect(minter).transfer(ADMIN_ADDRESS, TRANSFER_AMOUNT)
    expect(await idiaContract.balanceOf(ADMIN_ADDRESS)).to.be.equals(initialBalance + TRANSFER_AMOUNT)
  })

  it('can mint, transfer, and claim voucher', async function () {
    const voucherValue = ethers.constants.WeiPerEther.mul(10)
    // approve vesting pool to spend max amount
    await idiaContract.connect(minter).approve(VESTINGPOOL_ADDRESS, ethers.constants.MaxUint256)
    // mint a voucher that worths 1 idia
    const tokenId = await voucherContract.nextTokenId()
    await voucherContract.connect(minter).mint(
        0, voucherValue, [1632960000], [10000], ''
    )
    expect(await voucherContract.nextTokenId()).to.be.equals((tokenId.toNumber() + 1).toString())

    // the minter claims the voucher
    const minterClaimValue = voucherValue.div(10).mul(1)
    expect(await voucherContract.claimableAmount(tokenId)).to.be.equals(voucherValue)
    await voucherContract.connect(minter).claim(tokenId, ethers.constants.WeiPerEther)
    expect(await voucherContract.claimableAmount(tokenId)).to.be.equals(voucherValue.sub(minterClaimValue))

    // the minter transfer the voucher to another address
    const userClaimValue = voucherValue.div(10).mul(2)
    const id = voucherContract.nextTokenId()
    await voucherContract.connect(minter)['transferFrom(address,address,uint256,uint256)'](minter.address, user.address, tokenId, userClaimValue)
    await voucherContract.connect(user).claim(id, userClaimValue)
    expect(await voucherContract.claimableAmount(tokenId)).to.be.equals(voucherValue.sub(minterClaimValue).sub(userClaimValue))
  })

  it('can batch mint', async function () {
    // get params and total idia needed
    const vouchers = BatchMintParams.vouchers
    const totalValue = vouchers.reduce((acc, voucher) => { 
      return acc.add(BigNumber.from(voucher.value)) }, BigNumber.from(0)
    )
    // deploy contract
    const mintVoucher = await (await ethers.getContractFactory('BatchMintVoucher')).connect(minter).deploy(PROXY_ADDRESS, IDIA_ADDRESS, VESTINGPOOL_ADDRESS)
    // approve the contract to spend idia
    await idiaContract.connect(minter).approve(mintVoucher.address, totalValue)
    const tokenId = await voucherContract.nextTokenId()

    // mint
    await mintVoucher.connect(minter).batchMint(
      totalValue,
      {
      users: vouchers.map((voucher) => voucher.address),
      terms: vouchers.map((voucher) => voucher.term),
      values: vouchers.map((voucher) => voucher.value),
      maturities: vouchers.map((voucher) => voucher.maturities),
      percentages: vouchers.map((voucher) => voucher.percentages),
      originalInvestors: vouchers.map((voucher) => voucher.originalInvestor),
      }
    )

    // check if the correct amount of vouchers are minted
    expect(await voucherContract.nextTokenId()).to.be.equals((tokenId.toNumber() + vouchers.length).toString())
  })
})