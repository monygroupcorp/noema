const { USD_PER_POINT } = require('../../../core/constants/economy');

function pointsToUsd(points) {
  return ((points || 0) * USD_PER_POINT).toFixed(2);
}

/**
 * Convert USDC atomic units (6 decimals) to a USD string.
 * @param {string|number} atomicAmount
 * @returns {string}
 */
function atomicUsdcToUsd(atomicAmount) {
  return (Number(atomicAmount) / 1e6).toFixed(6);
}

module.exports = { pointsToUsd, atomicUsdcToUsd };
