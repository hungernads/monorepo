/**
 * Utility functions for the dashboard
 */

/**
 * Shortens an Ethereum address to 0x1234...5678 format
 * @param address Full Ethereum address
 * @returns Shortened address string
 */
export function shortenAddress(address: string): string {
  if (!address) return '';
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Formats a number with thousands separators
 * @param num Number to format
 * @returns Formatted string
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}

/**
 * Formats a token amount with appropriate decimals
 * @param amount Token amount as string (wei)
 * @param decimals Number of decimals
 * @returns Formatted string
 */
export function formatTokenAmount(amount: string, decimals: number = 18): string {
  try {
    const value = BigInt(amount);
    const divisor = BigInt(10 ** decimals);
    const whole = value / divisor;
    return whole.toString();
  } catch {
    return '0';
  }
}
