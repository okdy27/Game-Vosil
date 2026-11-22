// chain.js - semua hal on-chain (World Chain, chain id 480) memakai viem. Dipanggil oleh app.js.
import { createPublicClient, createWalletClient, http, defineChain, recoverMessageAddress, isAddress as vIsAddress, erc20Abi, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_DEFAULT = 'https://worldchain-mainnet.g.alchemy.com/public';
const chainOf = (env) => defineChain({
  id: Number(env.CHAIN_ID || 480), name: 'World Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [env.RPC_URL || RPC_DEFAULT] } },
});
const pub = (env) => createPublicClient({ chain: chainOf(env), transport: http(env.RPC_URL || RPC_DEFAULT) });

export const isAddress = (a) => vIsAddress(a, { strict: false });

export async function verifySignature(address, message, signature) {
  try { return (await recoverMessageAddress({ message, signature })).toLowerCase() === address.toLowerCase(); } catch (e) { return false; }
}

export async function getBalance(env) {                          // saldo VOS dompet game (dalam VOS)
  const v = await pub(env).readContract({ address: env.TOKEN_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [env.GAME_WALLET_ADDRESS] });
  return Number(formatUnits(v, 18));
}

export async function sendPayout(env, to, amountWei) {
  if (!env.GAME_WALLET_KEY) throw new Error('GAME_WALLET_KEY belum diisi');
  const account = privateKeyToAccount(env.GAME_WALLET_KEY.startsWith('0x') ? env.GAME_WALLET_KEY : '0x' + env.GAME_WALLET_KEY);
  if (!env.GAME_WALLET_ADDRESS || account.address.toLowerCase() !== env.GAME_WALLET_ADDRESS.toLowerCase()) throw new Error('kunci tidak cocok dengan alamat dompet game');
  const wallet = createWalletClient({ account, chain: chainOf(env), transport: http(env.RPC_URL || RPC_DEFAULT) });
  return await wallet.writeContract({ address: env.TOKEN_ADDRESS, abi: erc20Abi, functionName: 'transfer', args: [to, amountWei] });
}

export async function getReceipt(env, hash) {
  try {
    const r = await pub(env).getTransactionReceipt({ hash });
    return r.status === 'success' ? 'success' : 'reverted';
  } catch (e) { return 'pending'; }
}
