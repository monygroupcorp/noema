const { USD_PER_POINT } = require('../../../core/constants/economy');

function pointsToUsd(points) {
  return ((points || 0) * USD_PER_POINT).toFixed(2);
}

module.exports = { pointsToUsd };
