console.log('Before loading .envDev:');
console.log('SUBSCRIPTION_ID:', process.env.SUBSCRIPTION_ID);

require('dotenv').config({ path: '.envDev' });

console.log('\nAfter loading .envDev:');
console.log('SUBSCRIPTION_ID:', process.env.SUBSCRIPTION_ID);
