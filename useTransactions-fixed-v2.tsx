import { useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { formatEther, parseEther } from 'viem';

export const useTransactions = (gameContractAddress: `0x${string}`) => {
  const publicClient = usePublicClient();
  const { 
    writeContract, 
    data: hash, 
    isPending: isWritePending, 
    error: writeError 
  } = useWriteContract();
  
  const { 
    isLoading: isConfirming, 
    isSuccess: isConfirmed, 
    error: receiptError 
  } = useWaitForTransactionReceipt({ hash });

  // Enhanced gas estimation with proper EIP-1559 pricing
  const getOptimizedGasConfig = useCallback(async (
    contractAddress: `0x${string}`,
    functionName: string,
    args: any[],
    account: `0x${string}`,
    value?: bigint
  ) => {
    try {
      console.log(`🔍 Estimating gas for ${functionName}...`);
      
      // Get current network gas pricing
      let baseFeePerGas: bigint;
      let gasPrice: bigint;
      
      try {
        const block = await publicClient?.getBlock({ blockTag: 'latest' });
        baseFeePerGas = block?.baseFeePerGas || parseEther('0.001'); // 1 gwei fallback
        
        // Get current gas price as additional reference
        gasPrice = await publicClient?.getGasPrice() || parseEther('0.002'); // 2 gwei fallback
        
        console.log(`📊 Network conditions:`, {
          baseFee: formatEther(baseFeePerGas),
          gasPrice: formatEther(gasPrice)
        });
      } catch (error) {
        console.warn('⚠️ Failed to get network gas info, using fallbacks');
        baseFeePerGas = parseEther('0.001'); // 1 gwei
        gasPrice = parseEther('0.002'); // 2 gwei
      }

      // Estimate gas limit
      let gasLimit: bigint;
      try {
        const estimatedGas = await publicClient?.estimateGas({
          account,
          to: contractAddress,
          data: publicClient.encodeFunctionData({
            abi: [
              {
                name: functionName,
                type: 'function',
                inputs: functionName === 'startGame' ? [] : [{ name: 'direction', type: 'uint8' }],
                outputs: [],
                stateMutability: functionName === 'startGame' ? 'payable' : 'nonpayable'
              }
            ],
            functionName,
            args
          }),
          value: value || 0n
        });
        
        // Add 25% buffer to estimated gas
        gasLimit = (estimatedGas * 125n) / 100n;
        console.log(`⛽ Gas estimation: ${estimatedGas.toString()} + buffer = ${gasLimit.toString()}`);
      } catch (error) {
        console.warn('⚠️ Gas estimation failed, using conservative fallback');
        // Use conservative fallbacks based on function
        gasLimit = functionName === 'startGame' ? 150000n : 100000n;
      }

      // Calculate proper EIP-1559 gas pricing
      // Priority fee: reasonable tip for miners (0.5-2 gwei range)
      const maxPriorityFeePerGas = baseFeePerGas < parseEther('0.001') 
        ? parseEther('0.0005') // 0.5 gwei for low base fee
        : parseEther('0.002');  // 2 gwei for higher base fee
      
      // Max fee: base fee + priority fee with buffer for fee spikes
      // Use higher of: (baseFee * 2 + priority) or (gasPrice + priority)
      const calculatedMaxFee = (baseFeePerGas * 2n) + maxPriorityFeePerGas;
      const gasPriceBasedFee = gasPrice + maxPriorityFeePerGas;
      const maxFeePerGas = calculatedMaxFee > gasPriceBasedFee ? calculatedMaxFee : gasPriceBasedFee;

      console.log(`💰 Gas pricing:`, {
        maxPriorityFee: formatEther(maxPriorityFeePerGas) + ' ETH',
        maxFee: formatEther(maxFeePerGas) + ' ETH',
        gasLimit: gasLimit.toString()
      });

      // Validation check
      if (maxPriorityFeePerGas >= maxFeePerGas) {
        console.warn('🚨 Invalid gas pricing detected, adjusting...');
        const adjustedMaxFee = maxPriorityFeePerGas * 3n; // Ensure maxFee is at least 3x priority fee
        return {
          gas: gasLimit,
          maxFeePerGas: adjustedMaxFee,
          maxPriorityFeePerGas: maxPriorityFeePerGas
        };
      }

      return {
        gas: gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas
      };

    } catch (error) {
      console.error('❌ Gas optimization failed:', error);
      
      // Ultra-conservative fallback that should always work
      return {
        gas: functionName === 'startGame' ? 150000n : 100000n,
        maxFeePerGas: parseEther('0.01'), // 10 gwei
        maxPriorityFeePerGas: parseEther('0.002') // 2 gwei
      };
    }
  }, [publicClient]);

  const startGame = useCallback(async (account: `0x${string}`) => {
    try {
      console.log('🚀 Starting new game...');
      
      const gasConfig = await getOptimizedGasConfig(
        gameContractAddress,
        'startGame',
        [],
        account,
        parseEther('0.001') // 0.001 ETH entry fee
      );

      await writeContract({
        address: gameContractAddress,
        abi: [{
          name: 'startGame',
          type: 'function',
          inputs: [],
          outputs: [],
          stateMutability: 'payable'
        }],
        functionName: 'startGame',
        value: parseEther('0.001'),
        ...gasConfig
      });

      console.log('✅ Game start transaction submitted');
    } catch (error) {
      console.error('❌ Start game failed:', error);
      throw error;
    }
  }, [gameContractAddress, getOptimizedGasConfig, writeContract]);

  const playMove = useCallback(async (direction: number, account: `0x${string}`) => {
    try {
      console.log(`🎮 Playing move: ${direction}`);
      
      const gasConfig = await getOptimizedGasConfig(
        gameContractAddress,
        'play',
        [direction],
        account
      );

      await writeContract({
        address: gameContractAddress,
        abi: [{
          name: 'play',
          type: 'function',
          inputs: [{ name: 'direction', type: 'uint8' }],
          outputs: [],
          stateMutability: 'nonpayable'
        }],
        functionName: 'play',
        args: [direction],
        ...gasConfig
      });

      console.log('✅ Move transaction submitted');
    } catch (error) {
      console.error('❌ Play move failed:', error);
      throw error;
    }
  }, [gameContractAddress, getOptimizedGasConfig, writeContract]);

  return {
    startGame,
    playMove,
    hash,
    isWritePending,
    isConfirming,
    isConfirmed,
    error: writeError || receiptError
  };
};